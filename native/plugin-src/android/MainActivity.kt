// Replace the generated MainActivity at:
//   android/app/src/main/java/com/xpelbeauty/xtend/MainActivity.kt
// The one added line registers the LocationIntegrity plugin with Capacitor.

package com.xpelbeauty.xtend

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(LocationIntegrity::class.java)
        super.onCreate(savedInstanceState)
    }
}
