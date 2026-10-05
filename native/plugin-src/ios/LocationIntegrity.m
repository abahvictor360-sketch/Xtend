// Add this file to the iOS app target in Xcode, next to LocationIntegrity.swift.
// It registers the Swift plugin and its getFix method with Capacitor so the
// web app can reach it at window.Capacitor.Plugins.LocationIntegrity.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LocationIntegrity, "LocationIntegrity",
           CAP_PLUGIN_METHOD(getFix, CAPPluginReturnPromise);
)
