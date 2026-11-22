package com.mefistofelix.firegames

import android.content.res.AssetManager
import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * The server the phones talk to, on the TV itself. One port, plain HTTP:
 * - `GET /...` serves the web pages from the APK assets (`src/web`); `/` sends a phone to `/pad/`.
 * - `GET /info` tells the TV page the LAN address to print in the QR code.
 * - `GET /ws?id=<id>` is a WebSocket. Every text message is a JSON envelope `{from, to, body}` and is forwarded
 *   untouched to the socket registered with the id in `to`. The TV page registers as [HOST] and only from this
 *   device; the server knows nothing about the games. When a phone's socket closes, the host gets `{t: "bye"}`.
 */
class LanServer(private val assets: AssetManager, private val versionName: String) {
    private val server = ServerSocket()
    private val connections = ConcurrentHashMap<String, Connection>()

    fun start() {
        server.reuseAddress = true
        server.bind(InetSocketAddress(PORT))
        thread(name = "lan-accept", isDaemon = true) {
            while (true) {
                val socket = try {
                    server.accept()
                } catch (e: SocketException) {
                    break // stop() closed the server
                }
                thread(name = "lan-client", isDaemon = true) { serve(socket) }
            }
        }
    }

    fun stop() {
        server.close()
    }

    private fun serve(socket: Socket) {
        try {
            socket.use {
                val input = BufferedInputStream(socket.getInputStream())
                val requestLine = readLine(input) ?: return
                val headers = HashMap<String, String>()
                while (true) {
                    val line = readLine(input) ?: return
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
                }
                val parts = requestLine.split(" ")
                if (parts.size < 2 || parts[0] != "GET") {
                    respond(socket.getOutputStream(), "405 Method Not Allowed", "text/plain", ByteArray(0))
                    return
                }
                val uri = Uri.parse(parts[1])
                if (uri.path == "/ws") webSocket(socket, input, headers, uri) else page(socket.getOutputStream(), uri.path ?: "/")
            }
        } catch (e: IOException) {
            // the client went away: nothing to do
        }
    }

    private fun page(output: OutputStream, path: String) {
        if (path == "/") {
            output.write("HTTP/1.1 302 Found\r\nLocation: /pad/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            return
        }
        if (path == "/info") {
            val info = JSONObject().put("ip", lanAddress()).put("port", PORT).put("version", versionName)
            respond(output, "200 OK", "application/json", info.toString().toByteArray())
            return
        }
        val file = if (path.endsWith("/")) path + "index.html" else path
        val body = try {
            if (file.contains("..")) throw IOException("path outside the assets")
            assets.open(file.trimStart('/')).use { it.readBytes() }
        } catch (e: IOException) {
            respond(output, "404 Not Found", "text/plain", "Not found".toByteArray())
            return
        }
        respond(output, "200 OK", MIME_TYPES[file.substringAfterLast('.')] ?: "application/octet-stream", body)
    }

    private fun respond(output: OutputStream, status: String, type: String, body: ByteArray) {
        // no-cache: after an app update the phones must not keep the pages of the previous build
        val head = "HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
            "Cache-Control: no-cache\r\nConnection: close\r\n\r\n"
        output.write(head.toByteArray())
        output.write(body)
        output.flush()
    }

    private fun webSocket(socket: Socket, input: InputStream, headers: Map<String, String>, uri: Uri) {
        val output = socket.getOutputStream()
        val id = uri.getQueryParameter("id")
        val key = headers["sec-websocket-key"]
        val hostFromOutside = id == HOST && !socket.inetAddress.isLoopbackAddress
        if (id.isNullOrEmpty() || key == null || hostFromOutside) {
            respond(output, "403 Forbidden", "text/plain", ByteArray(0))
            return
        }
        val accept = Base64.encodeToString(
            MessageDigest.getInstance("SHA-1").digest((key + WEBSOCKET_GUID).toByteArray()), Base64.NO_WRAP)
        output.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: $accept\r\n\r\n").toByteArray())
        output.flush()

        val connection = Connection(output)
        connections[id] = connection // a reconnecting phone replaces its old socket
        try {
            while (true) {
                val message = readMessage(input, connection) ?: break
                val to = JSONObject(message).optString("to")
                connections[to]?.sendText(message)
            }
        } finally {
            val wasCurrent = connections.remove(id, connection)
            if (wasCurrent && id != HOST) {
                val bye = JSONObject().put("from", id).put("to", HOST).put("body", JSONObject().put("t", "bye"))
                connections[HOST]?.sendText(bye.toString())
            }
        }
    }

    /** Next text message of a WebSocket (fragments joined), or null when the peer closed it. */
    private fun readMessage(input: InputStream, connection: Connection): String? {
        val message = ByteArrayOutputStream()
        while (true) {
            val first = input.read()
            val second = input.read()
            if (first < 0 || second < 0) return null
            val opcode = first and 0x0f
            val finished = (first and 0x80) != 0
            // 0..125 is the length itself; 126 and 127 announce a 16 or 64 bit length in the next bytes
            val announced = second and 0x7f
            val length = when (announced) {
                126 -> readNumber(input, 2) ?: return null
                127 -> readNumber(input, 8) ?: return null
                else -> announced.toLong()
            }
            if (length < 0 || length > MAX_MESSAGE_BYTES) return null
            val masked = (second and 0x80) != 0
            val mask = if (masked) readBytes(input, 4) ?: return null else null
            val payload = readBytes(input, length.toInt()) ?: return null
            if (mask != null) {
                for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
            }
            when (opcode) {
                OPCODE_CLOSE -> return null
                OPCODE_PING -> connection.sendFrame(OPCODE_PONG, payload)
                OPCODE_PONG -> {}
                else -> {
                    message.write(payload)
                    if (finished) return message.toString("UTF-8")
                }
            }
        }
    }

    private fun readBytes(input: InputStream, count: Int): ByteArray? {
        val bytes = ByteArray(count)
        var done = 0
        while (done < count) {
            val read = input.read(bytes, done, count - done)
            if (read < 0) return null
            done += read
        }
        return bytes
    }

    private fun readNumber(input: InputStream, byteCount: Int): Long? {
        val bytes = readBytes(input, byteCount) ?: return null
        var value = 0L
        for (byte in bytes) value = (value shl 8) or (byte.toLong() and 0xff)
        return value
    }

    private fun readLine(input: InputStream): String? {
        val line = ByteArrayOutputStream()
        while (true) {
            val byte = input.read()
            if (byte < 0) return null
            if (byte == '\n'.code) return line.toString("ISO-8859-1").trimEnd('\r')
            line.write(byte)
        }
    }

    /** IPv4 address of this TV on the home network, or 127.0.0.1 when it is not connected. */
    private fun lanAddress(): String {
        for (network in NetworkInterface.getNetworkInterfaces()) {
            if (!network.isUp || network.isLoopback) continue
            for (address in network.inetAddresses) {
                if (address is Inet4Address && address.isSiteLocalAddress) return address.hostAddress ?: continue
            }
        }
        return "127.0.0.1"
    }

    private class Connection(private val output: OutputStream) {
        fun sendText(text: String) = sendFrame(OPCODE_TEXT, text.toByteArray())

        @Synchronized
        fun sendFrame(opcode: Int, payload: ByteArray) {
            val frame = ByteArrayOutputStream()
            frame.write(0x80 or opcode)
            if (payload.size < 126) {
                frame.write(payload.size)
            } else if (payload.size < 65536) {
                frame.write(126)
                frame.write(payload.size shr 8)
                frame.write(payload.size and 0xff)
            } else {
                frame.write(127)
                for (shift in 56 downTo 0 step 8) frame.write(((payload.size.toLong() shr shift) and 0xff).toInt())
            }
            frame.write(payload)
            try {
                output.write(frame.toByteArray())
                output.flush()
            } catch (e: IOException) {
                // the receiver is gone; its own read loop notices and unregisters it
            }
        }
    }

    companion object {
        const val PORT = 8080
        private const val HOST = "tv"
        private const val WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        private const val MAX_MESSAGE_BYTES = 1024 * 1024
        private const val OPCODE_TEXT = 1
        private const val OPCODE_CLOSE = 8
        private const val OPCODE_PING = 9
        private const val OPCODE_PONG = 10
        private val MIME_TYPES = mapOf(
            "html" to "text/html; charset=utf-8",
            "js" to "text/javascript; charset=utf-8",
            "css" to "text/css; charset=utf-8",
            "json" to "application/json",
            "svg" to "image/svg+xml",
            "png" to "image/png",
            "glb" to "model/gltf-binary",
            "jpg" to "image/jpeg",
            "webp" to "image/webp",
            "mp3" to "audio/mpeg",
            "ogg" to "audio/ogg",
            "wav" to "audio/wav",
            "woff2" to "font/woff2",
        )
    }
}
