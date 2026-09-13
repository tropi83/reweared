// Post on Vinted from iOS: a WKWebView presented over the app, restricted to the Vinted
// marketplaces and the login providers, that pre-fills the sell form and never clicks "Add".
//
// NOT YET COMPILED: written without a Mac, mirroring VintedActivity.kt line by line and the
// official Tauri plugin conventions (see BUILDING.md, "Verify the Vinted screen on iOS").

import SwiftRs
import Tauri
import UIKit
import WebKit

struct PrefillPhoto: Decodable {
  let name: String
  let mimeType: String
  let data: String
}

struct PrefillPayload: Decodable {
  let title: String
  let description: String
  let photos: [PrefillPhoto]
}

/// Mirrors `RunRequest` in the Rust crate: the policy is computed there, never here.
struct RunRequest: Decodable {
  let home: String
  let sellPath: String
  let allowedHosts: [String]
  let script: String
  let payload: PrefillPayload
}

/// Fixed identifier of the WKWebsiteDataStore holding the Vinted session (iOS 17+), constant so
/// the same store is reused and can be removed. Below iOS 17 the default store is used.
let vintedDataStoreId = UUID(uuidString: "7A1C539E-B42D-4F08-9D61-C03B5E72A914")!

class VintedWebviewPlugin: Plugin {
  private var controller: VintedViewController?

  @objc public func run(_ invoke: Invoke) throws {
    guard controller == nil else {
      invoke.reject("a Vinted screen is already open")
      return
    }
    let request = try invoke.parseArgs(RunRequest.self)
    let vc = VintedViewController(request: request) { [weak self] report in
      self?.controller = nil
      invoke.resolve(["report": report ?? NSNull()])
    }
    controller = vc
    let nav = UINavigationController(rootViewController: vc)
    nav.modalPresentationStyle = .fullScreen
    manager.viewController?.present(nav, animated: true, completion: nil)
  }

  /// Erases the Vinted session: the dedicated data store on iOS 17+, otherwise every website
  /// data of the default store (the app's own WebView keeps nothing there — local-first).
  @objc public func clearSession(_ invoke: Invoke) {
    if #available(iOS 17.0, *) {
      WKWebsiteDataStore.remove(forIdentifier: vintedDataStoreId) { error in
        if let error = error, (error as NSError).code != WKError.Code.unknown.rawValue {
          invoke.reject(error.localizedDescription)
        } else {
          invoke.resolve()
        }
      }
    } else {
      let types = WKWebsiteDataStore.allWebsiteDataTypes()
      WKWebsiteDataStore.default().removeData(ofTypes: types, modifiedSince: .distantPast) {
        invoke.resolve()
      }
    }
  }
}

class VintedViewController: UIViewController, WKNavigationDelegate {
  private static let pollInterval: TimeInterval = 0.3
  private static let pollTimeout: TimeInterval = 20

  private let request: RunRequest
  private let onClose: ([String: Any]?) -> Void
  private var webView: WKWebView!
  private let status = UILabel()
  private var lastReport: [String: Any]?
  private var pollTimer: Timer?
  private var pollStartedAt = Date()

  init(request: RunRequest, onClose: @escaping ([String: Any]?) -> Void) {
    self.request = request
    self.onClose = onClose
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Vinted"
    view.backgroundColor = .systemBackground
    navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(closeTapped))

    let config = WKWebViewConfiguration()
    if #available(iOS 17.0, *) {
      config.websiteDataStore = WKWebsiteDataStore(forIdentifier: vintedDataStoreId)
    }
    config.allowsInlineMediaPlayback = true
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.allowsBackForwardNavigationGestures = true

    status.font = .systemFont(ofSize: 13)
    status.numberOfLines = 0
    status.text = localized("vinted_status_login")

    let stack = UIStackView(arrangedSubviews: [status, webView])
    stack.axis = .vertical
    stack.spacing = 4
    stack.isLayoutMarginsRelativeArrangement = true
    stack.layoutMargins = UIEdgeInsets(top: 6, left: 16, bottom: 0, right: 16)
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])

    if let url = URL(string: request.home) { webView.load(URLRequest(url: url)) }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // Dismissed by the Close button or by a swipe: either way the app gets the last report.
    if isBeingDismissed || navigationController?.isBeingDismissed == true {
      pollTimer?.invalidate()
      onClose(lastReport)
    }
  }

  @objc private func closeTapped() {
    dismiss(animated: true, completion: nil)
  }

  private func isAllowed(_ url: URL?) -> Bool {
    guard let url = url, url.scheme == "https", let host = url.host else { return false }
    return request.allowedHosts.contains(host)
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    // Same rule as the desktop window: https + exact host from the allow-list; everything else is blocked.
    decisionHandler(isAllowed(navigationAction.request.url) ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let url = webView.url, isAllowed(url) else { return }
    if url.path.hasPrefix(request.sellPath) {
      fillForm()
    } else {
      status.text = localized("vinted_status_browse")
    }
  }

  /// Injects the bundled script and runs it with the payload, then watches its status.
  private func fillForm() {
    status.text = localized("vinted_status_filling")
    let payload: [String: Any] = [
      "title": request.payload.title,
      "description": request.payload.description,
      "photos": request.payload.photos.map { ["name": $0.name, "mimeType": $0.mimeType, "data": $0.data] },
    ]
    guard let json = try? JSONSerialization.data(withJSONObject: payload), let text = String(data: json, encoding: .utf8) else { return }
    // The bundle is idempotent; `run` stores its report on window.__aivPrefill.status.
    webView.evaluateJavaScript("\(request.script)\n;window.__aivPrefill.run(\(text));", completionHandler: nil)
    pollTimer?.invalidate()
    pollStartedAt = Date()
    pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] timer in
      self?.poll(timer)
    }
  }

  private func poll(_ timer: Timer) {
    webView.evaluateJavaScript("JSON.stringify((window.__aivPrefill && window.__aivPrefill.status) || null)") { [weak self] value, _ in
      guard let self = self else { return }
      let report = self.parseStatus(value)
      if let report = report {
        self.lastReport = report
        self.showReport(report)
      }
      let photos = report?["photos"] as? [String: Any]
      let attached = photos?["attached"] as? Int ?? 0
      let requested = photos?["requested"] as? Int ?? 0
      let pageOk = report?["pageOk"] as? Bool ?? true
      let done = report != nil && (!pageOk || attached >= requested)
      if done || Date().timeIntervalSince(self.pollStartedAt) > Self.pollTimeout {
        timer.invalidate()
        if report == nil { self.status.text = self.localized("vinted_status_timeout") }
      }
    }
  }

  /// `evaluateJavaScript` hands back the string produced by `JSON.stringify` (or "null").
  private func parseStatus(_ value: Any?) -> [String: Any]? {
    guard let text = value as? String, text != "null", let data = text.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private func showReport(_ report: [String: Any]) {
    guard report["pageOk"] as? Bool == true else {
      status.text = localized("vinted_status_not_form")
      return
    }
    let photos = report["photos"] as? [String: Any]
    let title = mark(report["title"] as? String)
    let description = mark(report["description"] as? String)
    status.text = String(format: localized("vinted_status_filled"), title, description, photos?["attached"] as? Int ?? 0, photos?["requested"] as? Int ?? 0)
  }

  private func mark(_ result: String?) -> String { result == "filled" ? "✓" : "✗" }

  /// Strings live here (a Swift package has no resources without extra setup); French follows the device language.
  private func localized(_ key: String) -> String {
    let fr = Locale.preferredLanguages.first?.hasPrefix("fr") == true
    switch key {
    case "vinted_status_login":
      return fr ? "Connectez-vous à Vinted puis ouvrez le formulaire de vente : l'application le remplit." : "Sign in to Vinted, then open the sell form: the app fills it in."
    case "vinted_status_browse":
      return fr ? "Ouvrez le formulaire de vente (Vendre) pour qu'il soit rempli." : "Open the sell form (Sell) to have it filled in."
    case "vinted_status_filling":
      return fr ? "Remplissage du formulaire…" : "Filling the form…"
    case "vinted_status_filled":
      return fr ? "Titre %@ · Description %@ · Photos %d/%d — vérifiez, puis ajoutez manuellement." : "Title %@ · Description %@ · Photos %d/%d — check, then add manually."
    case "vinted_status_not_form":
      return fr ? "Cette page n'est pas le formulaire de vente." : "This page is not the sell form."
    default:
      return fr ? "Le formulaire n'a pas répondu. Rechargez la page pour réessayer." : "The form did not answer. Reload the page to try again."
    }
  }
}

@_cdecl("init_plugin_vinted_webview")
func initPlugin() -> Plugin {
  return VintedWebviewPlugin()
}
