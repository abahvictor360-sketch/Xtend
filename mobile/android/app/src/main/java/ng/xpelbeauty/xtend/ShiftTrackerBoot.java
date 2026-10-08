package ng.xpelbeauty.xtend;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The phone restarted (or the app was updated) in the middle of a shift:
 * carry on tracking without waiting for the person to open Xtend.
 */
public class ShiftTrackerBoot extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        if (!ShiftTrackerService.configured(context)) return;
        try {
            ShiftTrackerService.start(context);
        } catch (Exception ignored) {
            // Without "Allow all the time" Android may refuse; the app
            // restarts tracking the next time it is opened.
        }
    }
}
