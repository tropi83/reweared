package com.aiimagevariations.vinted

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * The Vinted screen: a plain WebView (no Tauri bridge) that only navigates to the Vinted
 * marketplaces and the three login providers, and pre-fills the sell form as soon as it is on
 * screen. It never clicks "Add". Closing returns the last fill report to the plugin.
 */
class VintedActivity : AppCompatActivity() {
  companion object {
    const val EXTRA_REPORT = "report"
    private const val POLL_INTERVAL_MS = 500L
    /** Without any report after this, the script did not run (page changed?): say so. */
    private const val POLL_TIMEOUT_MS = 20_000L
  }

  private lateinit var request: RunRequest
  private lateinit var webView: WebView
  private lateinit var status: TextView
  private val handler = Handler(Looper.getMainLooper())
  private var lastReport: JSONObject? = null
  private var pollStartedAt = 0L
  private var polling: Runnable? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val pending = PendingRun.request
    if (pending == null) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }
    request = pending

    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    val toolbar = Toolbar(this).apply {
      title = "Vinted"
      setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_clear_material)
      navigationContentDescription = getString(R.string.vinted_close)
      setNavigationOnClickListener { finishWithReport() }
    }
    status = TextView(this).apply {
      setPadding(dp(16), dp(6), dp(16), dp(6))
      textSize = 13f
      text = getString(R.string.vinted_status_login)
    }
    webView = WebView(this)
    root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    // Edge-to-edge (Android 15+): keep the toolbar and the page out of the status / navigation bars.
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    setContentView(root)
    // Light background: dark status-bar icons.
    WindowInsetsControllerCompat(window, root).isAppearanceLightStatusBars = true

    configureWebView()
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (webView.canGoBack()) webView.goBack() else finishWithReport()
      }
    })
    webView.loadUrl(request.home)
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun configureWebView() {
    // A profile of its own keeps the Vinted session apart from the app's WebView; must precede any load.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
      ProfileStore.getInstance().getOrCreateProfile(VINTED_PROFILE)
      WebViewCompat.setProfile(webView, VINTED_PROFILE)
    }
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      setSupportMultipleWindows(false)
      javaScriptCanOpenWindowsAutomatically = false
      mediaPlaybackRequiresUserGesture = true
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      setGeolocationEnabled(false)
    }
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
        // true = blocked. Same rule as the desktop window: https + exact host from the allow-list.
        return !isAllowed(req.url)
      }

      override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        stopPolling()
      }

      override fun onPageFinished(view: WebView, url: String?) {
        val uri = url?.let { Uri.parse(it) } ?: return
        if (!isAllowed(uri)) return
        if (uri.path?.startsWith(request.sellPath) == true) fillForm() else status.text = getString(R.string.vinted_status_browse)
      }
    }
  }

  private fun isAllowed(uri: Uri): Boolean = uri.scheme == "https" && request.allowedHosts.contains(uri.host ?: "")

  private fun stopPolling() {
    polling?.let { handler.removeCallbacks(it) }
    polling = null
  }

  /** Injects the bundled script and runs it with the payload, then follows its status while the form is on screen. */
  private fun fillForm() {
    status.text = getString(R.string.vinted_status_filling)
    val payload = JSONObject().apply {
      put("title", request.payload.title)
      put("description", request.payload.description)
      put("photos", JSONArray().apply {
        for (p in request.payload.photos) put(JSONObject().apply {
          put("name", p.name)
          put("mimeType", p.mimeType)
          put("data", p.data)
        })
      })
    }
    // The bundle is idempotent; `run` stores its report on window.__aivPrefill.status.
    webView.evaluateJavascript("${request.script}\n;window.__aivPrefill.run($payload);", null)
    stopPolling()
    pollStartedAt = System.currentTimeMillis()
    // Keeps going while the form is on screen: the paste icons change the status when the user taps them.
    val tick = object : Runnable {
      override fun run() {
        if (polling !== this) return
        webView.evaluateJavascript("JSON.stringify((window.__aivPrefill && window.__aivPrefill.status) || null)") { raw ->
          val report = parseStatus(raw)
          if (report != null) {
            lastReport = report
            showReport(report)
          } else if (System.currentTimeMillis() - pollStartedAt > POLL_TIMEOUT_MS) {
            status.text = getString(R.string.vinted_status_timeout)
          }
          if (polling === this) handler.postDelayed(this, POLL_INTERVAL_MS)
        }
      }
    }
    polling = tick
    handler.postDelayed(tick, POLL_INTERVAL_MS)
  }

  /** `evaluateJavascript` hands back JSON: for a `JSON.stringify` result that is a quoted string (double-encoded). */
  private fun parseStatus(raw: String?): JSONObject? {
    if (raw == null || raw == "null") return null
    return try {
      when (val outer = JSONTokener(raw).nextValue()) {
        is String -> if (outer == "null") null else JSONObject(outer)
        is JSONObject -> outer
        else -> null
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun showReport(report: JSONObject) {
    if (!report.optBoolean("pageOk", false)) {
      status.text = getString(R.string.vinted_status_not_form)
      return
    }
    val photos = report.optJSONObject("photos")
    val title = report.optString("title")
    val description = report.optString("description")
    val template = if (title == "ready" || description == "ready") R.string.vinted_status_ready else R.string.vinted_status_filled
    status.text = getString(template, mark(title), mark(description), photos?.optInt("attached") ?: 0, photos?.optInt("requested") ?: 0)
  }

  /** ✓ pasted · ⧉ icon waiting for a tap · ✗ field not found. */
  private fun mark(result: String): String = when (result) {
    "filled" -> "✓"
    "ready" -> "⧉"
    else -> "✗"
  }

  private fun finishWithReport() {
    val data = Intent()
    lastReport?.let { data.putExtra(EXTRA_REPORT, it.toString()) }
    setResult(RESULT_OK, data)
    finish()
  }

  override fun onDestroy() {
    stopPolling()
    if (this::webView.isInitialized) {
      (webView.parent as? ViewGroup)?.removeView(webView)
      webView.destroy()
    }
    super.onDestroy()
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
