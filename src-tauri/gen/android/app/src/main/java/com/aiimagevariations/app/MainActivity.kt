package com.aiimagevariations.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge draws the WebView under the status bar, the navigation bar and, when it is open,
    // the keyboard. The web UI has no safe-area handling, so reserve those areas natively: the
    // header no longer sits under the clock and focused inputs stay above the keyboard.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
      val reserved = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(reserved.left, reserved.top, reserved.right, reserved.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
