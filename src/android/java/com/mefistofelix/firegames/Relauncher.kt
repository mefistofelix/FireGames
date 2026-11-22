package com.mefistofelix.firegames

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The system kills the app while it replaces the APK, so after a self-update the user would be left on the
 * installer's "app installed" screen. MY_PACKAGE_REPLACED arrives in the new build: when the update was started by
 * [Updater] (not by adb or another installer) the app is opened again. Starting an activity from a receiver is allowed
 * up to API 28; on newer Fire OS the system may ignore it, and the user opens the app from the installer's "Apri".
 */
class Relauncher : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED || !Updater.takeRelaunch(context)) return
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
