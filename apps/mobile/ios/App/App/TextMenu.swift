import UIKit
import WebKit
import Capacitor

/**
 * 본문 텍스트를 선택할 때 iOS 편집 메뉴(복사·찾아보기·공유…)를 숨긴다.
 * 앱의 선택 메뉴(가지·서식·복사)와 겹치지 않게 한다. 입력창을 편집할 때는 웹이 해제를 알려 기본 메뉴를 쓴다.
 */
enum TextMenuState {
    static var suppressed = true
}

final class AppWebView: WKWebView {
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if TextMenuState.suppressed { return false }
        return super.canPerformAction(action, withSender: sender)
    }

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard TextMenuState.suppressed else { return }
        let menus: [UIMenu.Identifier] = [.standardEdit, .lookup, .share, .replace, .learn, .speech, .format, .textStyle, .spelling]
        for id in menus { builder.remove(menu: id) }
    }
}

class AppViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        AppWebView(frame: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TextMenuPlugin())
    }
}

@objc(TextMenuPlugin)
public class TextMenuPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextMenuPlugin"
    public let jsName = "TextMenu"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSuppressed", returnType: CAPPluginReturnPromise)
    ]

    @objc func setSuppressed(_ call: CAPPluginCall) {
        TextMenuState.suppressed = call.getBool("value") ?? true
        call.resolve()
    }
}
