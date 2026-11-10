import AVFoundation
import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Playback ignores the silent switch and keeps the current passage going when the screen locks.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [])
        try? session.setActive(true)
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// Capacitor bridge that registers the on-device voice. The storyboard and SceneDelegate both use this class.
class ReadAloudViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeviceSpeechPlugin())
    }
}

/// AVSpeechSynthesizer for the bundled app. WKWebView's Web Speech API is not used.
@objc(DeviceSpeechPlugin)
public class DeviceSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "DeviceSpeechPlugin"
    public let jsName = "DeviceSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var pending: CAPPluginCall?
    /// True while stopSpeaking is running, so its didCancel does not resolve the next utterance.
    private var replacing = false

    override public func load() {
        synthesizer.delegate = self
        // Share the app session configured in AppDelegate so background audio applies.
        synthesizer.usesApplicationAudioSession = true
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.resolve()
            return
        }
        let lang = call.getString("lang") ?? "en-US"
        let rate = call.getFloat("rate") ?? 1
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [])
        try? session.setActive(true)
        if synthesizer.delegate == nil {
            synthesizer.delegate = self
            synthesizer.usesApplicationAudioSession = true
        }
        cancelCurrent()
        pending = call
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: lang) ?? AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = DeviceSpeechPlugin.adjustRate(rate)
        synthesizer.speak(utterance)
    }

    @objc func stop(_ call: CAPPluginCall) {
        cancelCurrent()
        call.resolve()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finishPending()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        if replacing { return }
        finishPending()
    }

    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        willSpeakRangeOfSpeechString characterRange: NSRange,
        utterance: AVSpeechUtterance
    ) {
        notifyListeners("boundary", data: [
            "charIndex": characterRange.location,
            "charLength": characterRange.length,
        ])
    }

    /// Web Speech rate 1 maps to AVSpeechUtteranceDefaultSpeechRate. Faster rates stay intelligible.
    private static func adjustRate(_ rate: Float) -> Float {
        let base = AVSpeechUtteranceDefaultSpeechRate
        let scaled: Float = rate >= 1 ? (0.1 * rate) + (base - 0.1) : rate * base
        return min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, scaled))
    }

    private func cancelCurrent() {
        replacing = true
        synthesizer.stopSpeaking(at: .immediate)
        replacing = false
        finishPending()
    }

    private func finishPending() {
        let call = pending
        pending = nil
        call?.resolve()
    }
}
