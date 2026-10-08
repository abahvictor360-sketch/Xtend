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
    }
}
