package com.aiimagevariations.vinted

import android.app.Activity
import android.content.Intent
import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.activity.result.ActivityResult
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewFeature
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class PrefillPhoto {
  lateinit var name: String
  lateinit var mimeType: String
  lateinit var data: String
}

@InvokeArg
class PrefillPayload {
  lateinit var title: String
  lateinit var description: String
  lateinit var photos: Array<PrefillPhoto>
}

/** Mirrors `RunRequest` in the Rust crate: the policy is computed there, never here. */
@InvokeArg
class RunRequest {
  lateinit var home: String
  lateinit var sellPath: String
  lateinit var allowedHosts: Array<String>
  lateinit var script: String
  lateinit var payload: PrefillPayload
}

/**
 * The request the activity is about to serve. Photos make the request tens of megabytes, far beyond
 * what an Intent may carry (Binder caps a transaction around 1 MB), so it stays in process memory
 * and is dropped as soon as the activity has read it.
 */
object PendingRun {
  @Volatile
  var request: RunRequest? = null
}

/** Name of the WebView profile holding the Vinted session (cookies, storage, cache), when supported. */
const val VINTED_PROFILE = "vinted"

@TauriPlugin
class VintedWebviewPlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun run(invoke: Invoke) {
    if (PendingRun.request != null) {
      invoke.reject("a Vinted screen is already open")
      return
    }
    try {
      PendingRun.request = invoke.parseArgs(RunRequest::class.java)
      startActivityForResult(invoke, Intent(activity, VintedActivity::class.java), "onRunResult")
    } catch (ex: Exception) {
      PendingRun.request = null
      invoke.reject(ex.message ?: "could not open the Vinted screen")
    }
  }

  @ActivityCallback
  fun onRunResult(invoke: Invoke, result: ActivityResult) {
    PendingRun.request = null
    val response = JSObject()
    val raw = result.data?.getStringExtra(VintedActivity.EXTRA_REPORT)
    val report = raw?.let { runCatching { JSObject(it) }.getOrNull() }
    response.put("report", report ?: JSONObject.NULL)
    invoke.resolve(response)
  }

  /**
   * Erases the Vinted session. With the Profile API the dedicated profile's cookies and storage are
   * wiped (a profile cannot be deleted while a destroyed WebView is still attached to it, until the
   * GC lets go — clearing its data works at any time); older WebViews share one cookie jar per
   * process, so everything is cleared (the app's own WebView holds nothing of value: local-first,
   * OAuth runs in the system browser).
   */
  @Command
  fun clearSession(invoke: Invoke) {
    try {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
        val store = ProfileStore.getInstance()
        if (store.getAllProfileNames().contains(VINTED_PROFILE)) {
          val profile = store.getProfile(VINTED_PROFILE)
          profile?.cookieManager?.removeAllCookies(null)
          profile?.cookieManager?.flush()
          profile?.webStorage?.deleteAllData()
        }
      } else {
        CookieManager.getInstance().removeAllCookies(null)
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteAllData()
      }
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "could not clear the Vinted session")
    }
  }
}
