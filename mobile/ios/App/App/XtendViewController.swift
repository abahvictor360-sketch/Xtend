import Capacitor

/// The app's web view, with the plugins that live in this project (rather
/// than in an npm package) registered.
class XtendViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocationIntegrity())
    }
}
