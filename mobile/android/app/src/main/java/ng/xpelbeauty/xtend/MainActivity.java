package ng.xpelbeauty.xtend;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live in this project rather than in an npm package.
        registerPlugin(LocationIntegrity.class);
        registerPlugin(ShiftTracker.class);
        super.onCreate(savedInstanceState);
        // Downloads (exports, login sheet, count template, report files):
        // a WebView drops them unless told where they go.
        if (getBridge() != null) XtendDownloads.attach(this, getBridge().getWebView());
        followTextSize();
    }

    @Override
    public void onResume() {
        super.onResume();
        // The person may have changed the phone's font size meanwhile.
        followTextSize();
    }

    /**
     * Text follows the phone's font size setting (Settings, Display, Font
     * size), from 85% up to twice the normal size. A WebView ignores it
     * unless told.
     */
    private void followTextSize() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        float scale = getResources().getConfiguration().fontScale;
        int zoom = Math.round(Math.max(0.85f, Math.min(2f, scale)) * 100);
        getBridge().getWebView().getSettings().setTextZoom(zoom);
    }
}
