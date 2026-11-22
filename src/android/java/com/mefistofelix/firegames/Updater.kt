package com.mefistofelix.firegames

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * Self-update without an app store, same scheme as the other Fire TV apps (FireBro, WLTV). [MANIFEST_URL] (file in
 * the public repository mefistofelix/firetv-apps, whose releases `firegames-N` hold the APKs; both written by
 * release.sh) describes the newest build:
 * `{"versionCode": N, "versionName": "0.1.N", "url": "<apk>", "sha256": "<hex>", "size": bytes}`.
 * A newer build is offered in a dialog; the APK is downloaded to the cache, checked against the SHA-256 and handed to
 * the system installer through a PackageInstaller session, whose own screen asks for the final "Installa" (apps
 * cannot install silently). Android refuses an APK not signed with the same key.
 */
class Updater(private val context: Context) {
    class Release(val code: Int, val name: String, val url: String, val sha256: String, val size: Long)

    private val preferences = context.getSharedPreferences("update", Context.MODE_PRIVATE)
    @Volatile private var busy = false

    private val installed = context.packageManager.getPackageInfo(context.packageName, 0)
    @Suppress("DEPRECATION")
    val installedCode: Int = installed.versionCode
    val installedName: String = installed.versionName ?: ""

    /** Reads the manifest in the background; [found] runs on that thread with a newer build (null: none / failed). */
    fun check(found: (Release?) -> Unit) {
        if (busy) return
        val now = System.currentTimeMillis()
        if (now - preferences.getLong("checkedAt", 0) in 0 until MIN_INTERVAL_MS) return
        preferences.edit().putLong("checkedAt", now).apply()
        thread(name = "update-check") {
            val release = try {
                val connection = open(MANIFEST_URL)
                val manifest = JSONObject(connection.inputStream.use { it.readBytes().toString(Charsets.UTF_8) })
                Release(manifest.getInt("versionCode"), manifest.optString("versionName"), manifest.getString("url"),
                    manifest.getString("sha256").lowercase(), manifest.optLong("size", -1))
            } catch (e: Exception) {
                Log.w(TAG, "update check failed: $e") // no network, or nothing published yet
                null
            }
            found(if (release != null && release.code > installedCode) release else null)
        }
    }

    /** True when the user said "Più tardi" to this build less than [SNOOZE_MS] ago. */
    fun snoozed(release: Release) = preferences.getInt("snoozeCode", 0) == release.code &&
        System.currentTimeMillis() - preferences.getLong("snoozeAt", 0) < SNOOZE_MS

    fun snooze(release: Release) = preferences.edit()
        .putInt("snoozeCode", release.code)
        .putLong("snoozeAt", System.currentTimeMillis())
        .apply()

    /**
     * Downloads [release] and opens the system installer. [progress] gets 0..100 (on the download thread), [failed] a
     * message. The installer's answer comes back to [activity] as an intent with action [ACTION_RESULT].
     */
    fun install(activity: Activity, release: Release, progress: (Int) -> Unit, failed: (String) -> Unit) {
        if (busy) return
        busy = true
        thread(name = "update-download") {
            try {
                val apk = File(context.cacheDir, "update.apk")
                download(release, apk, progress)
                commit(activity, apk)
            } catch (e: Exception) {
                Log.w(TAG, "update failed: $e")
                failed(e.message ?: e.javaClass.simpleName)
            } finally {
                busy = false
            }
        }
    }

    private fun open(url: String): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.setRequestProperty("User-Agent", "FireGames")
        connection.setRequestProperty("Cache-Control", "no-cache")
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        if (connection.responseCode != 200) throw IllegalStateException("HTTP ${connection.responseCode}")
        return connection
    }

    private fun download(release: Release, target: File, progress: (Int) -> Unit) {
        val digest = MessageDigest.getInstance("SHA-256")
        val connection = open(release.url)
        val total = if (release.size > 0) release.size else connection.contentLength.toLong()
        connection.inputStream.use { input ->
            target.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                var done = 0L
                var shown = -1
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    digest.update(buffer, 0, read)
                    done += read
                    if (done > MAX_BYTES) throw IllegalStateException("file troppo grande")
                    val percent = if (total > 0) (done * 100 / total).toInt().coerceIn(0, 100) else 0
                    if (percent != shown) {
                        shown = percent
                        progress(percent)
                    }
                }
            }
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (hex != release.sha256) {
            target.delete()
            throw IllegalStateException("file arrivato danneggiato")
        }
    }

    private fun commit(activity: Activity, apk: File) {
        val installer = context.packageManager.packageInstaller
        val parameters = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        parameters.setAppPackageName(context.packageName)
        parameters.setSize(apk.length())
        val sessionId = installer.createSession(parameters)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("base.apk", 0, apk.length()).use { output ->
                    input.copyTo(output, 64 * 1024)
                    session.fsync(output)
                }
            }
            val back = Intent(activity, activity.javaClass).setAction(ACTION_RESULT)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= 31) flags = flags or PendingIntent.FLAG_MUTABLE
            // read by Relauncher once the new build is in place: reopen the app (only after our own update)
            preferences.edit().putLong(RELAUNCH_AT, System.currentTimeMillis()).commit()
            session.commit(PendingIntent.getActivity(activity, sessionId, back, flags).intentSender)
        }
        apk.delete()
    }

    companion object {
        private const val TAG = "FireGames"
        const val ACTION_RESULT = "com.mefistofelix.firegames.UPDATE_RESULT"
        const val MANIFEST_URL = "https://raw.githubusercontent.com/mefistofelix/firetv-apps/main/firegames.json"
        private const val SNOOZE_MS = 12L * 3600 * 1000
        private const val MIN_INTERVAL_MS = 2 * 60_000L
        private const val MAX_BYTES = 100L * 1024 * 1024
        private const val RELAUNCH_AT = "relaunchAt"
        private const val RELAUNCH_WINDOW_MS = 15 * 60_000L

        /** True (once) when an update started by this app in the last minutes has just been installed. */
        fun takeRelaunch(context: Context): Boolean {
            val preferences = context.getSharedPreferences("update", Context.MODE_PRIVATE)
            val at = preferences.getLong(RELAUNCH_AT, 0)
            if (at == 0L) return false
            preferences.edit().remove(RELAUNCH_AT).commit()
            return System.currentTimeMillis() - at in 0 until RELAUNCH_WINDOW_MS
        }

        /**
         * Handles the installer's answer; returns a message for the user, or null when nothing needs saying.
         * A "user action" answer carries the installer's confirmation screen, which is opened here.
         */
        fun handleResult(activity: Activity, intent: Intent): String? {
            val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
            return when (status) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                        ?: return "Installazione non avviata"
                    activity.startActivity(confirm)
                    null
                }
                PackageInstaller.STATUS_SUCCESS -> null // the process is replaced, nothing to show
                PackageInstaller.STATUS_FAILURE_ABORTED -> "Aggiornamento annullato"
                else -> "Aggiornamento non riuscito: " +
                    (intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "errore $status")
            }
        }
    }
}
