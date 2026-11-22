package com.mefistofelix.firegames

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast

/**
 * The whole TV side is a web page (`src/web/tv`), shown full screen in a WebView and served by [LanServer],
 * the same server the phones connect to. The native part only hosts it and keeps the app updated ([Updater]).
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var server: LanServer
    private lateinit var updater: Updater
    private var updateDialog: AlertDialog? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        updater = Updater(this)
        server = LanServer(assets, updater.installedName)
        server.start()

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false // sound effects without a click
        web.webViewClient = WebViewClient()
        web.webChromeClient = object : WebChromeClient() {
            // the page's console goes to logcat: adb logcat -s FireGames
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i("FireGames", "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }
        setContentView(web)
        web.loadUrl("http://127.0.0.1:${LanServer.PORT}/tv/index.html")
    }

    override fun onResume() {
        super.onResume()
        updater.check { release ->
            if (release != null && !updater.snoozed(release)) runOnUiThread { offerUpdate(release) }
        }
    }

    /** Back first goes to the page (a running game asks to confirm); the lobby lets it close the app. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.onTvBack ? window.onTvBack() : false") { handled ->
            if (handled != "true") finish()
        }
    }

    override fun onDestroy() {
        server.stop()
        web.destroy()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action != Updater.ACTION_RESULT) return
        updateDialog?.dismiss()
        val message = Updater.handleResult(this, intent) ?: return
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun offerUpdate(release: Updater.Release) {
        if (isFinishing || updateDialog?.isShowing == true) return
        updateDialog = AlertDialog.Builder(this)
            .setTitle("Aggiornamento disponibile")
            .setMessage("Fire Games ${release.name}")
            .setPositiveButton("Installa") { _, _ -> downloadUpdate(release) }
            .setNegativeButton("Più tardi") { _, _ -> updater.snooze(release) }
            .show()
    }

    private fun downloadUpdate(release: Updater.Release) {
        val dialog = AlertDialog.Builder(this)
            .setTitle("Scarico l'aggiornamento")
            .setMessage("0%")
            .setCancelable(false)
            .show()
        updateDialog = dialog
        updater.install(this, release,
            progress = { percent -> runOnUiThread { dialog.setMessage("$percent%") } },
            failed = { message ->
                runOnUiThread {
                    dialog.dismiss()
                    Toast.makeText(this, "Aggiornamento non riuscito: $message", Toast.LENGTH_LONG).show()
                }
            })
    }
}
