package fr.perso.calmgram

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Instagram web dans une WebView, avec calmfeed.js injecté.
 *
 * Volontairement, il n'y a AUCUN pont entre la page et l'appli
 * (pas d'addJavascriptInterface, pas de WebMessageListener) :
 * la page ne peut rien transmettre à l'appli, et l'appli ne lit rien de la page.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var documentStartSupported = false
    private var pendingMediaRequest: PermissionRequest? = null
    private var pendingMediaResources: List<String> = emptyList()

    private val calmScript by lazy {
        assets.open("calmfeed.js").bufferedReader().use { it.readText() }
    }

    // Sélecteur de fichiers Android pour les <input type=file> (photos en message).
    private val filePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris: Array<Uri>? = if (result.resultCode != RESULT_OK) {
                null
            } else {
                val clip = result.data?.clipData
                if (clip != null) {
                    Array(clip.itemCount) { clip.getItemAt(it).uri }
                } else {
                    WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
                }
            }
            pendingFileCallback?.onReceiveValue(uris)
            pendingFileCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // En debug uniquement : permet d'inspecter la page depuis chrome://inspect sur le PC.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView = WebView(this).apply { fitsSystemWindows = true }
        setContentView(webView)
        setUpWebView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (isCallUrl(webView.url)) leaveCallPage()
                else if (webView.canGoBack()) webView.goBack()
                else finish()
            }
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(if (intent?.action == ACTION_SETTINGS) SETTINGS_URL else START_URL)
        }
    }

    // L'activité est en singleTask : le raccourci "Réglages" arrive ici si l'appli tourne déjà.
    // Un tap sur l'icône principale ne recharge rien : on reprend là où on était.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_SETTINGS) webView.loadUrl(SETTINGS_URL)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView(view: WebView) {
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            setSupportMultipleWindows(false)
            // Instagram traite différemment les WebView : on se présente comme Chrome mobile.
            userAgentString = userAgentString
                .replace("; wv", "")
                .replace(Regex("Version/\\S+ "), "")
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(view, true)
        }

        documentStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        if (documentStartSupported) {
            // Exécuté avant les scripts d'Instagram, uniquement sur www.instagram.com.
            WebViewCompat.addDocumentStartJavaScript(view, calmScript, setOf(INSTAGRAM_ORIGIN))
        }

        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false // iframes (ex. captcha) : laisser faire
                val uri = request.url
                if (uri.scheme == "https" && isInAppHost(uri.host)) return false
                // Liens externes -> navigateur. Schémas instagram://, intent:// -> ignorés,
                // pour ne jamais basculer vers l'appli officielle.
                if (uri.scheme == "http" || uri.scheme == "https") openExternally(uri)
                return true
            }

            override fun onPageCommitVisible(view: WebView, url: String) {
                // Repli pour les très vieilles WebView sans injection en début de page.
                if (!documentStartSupported && Uri.parse(url).host == INSTAGRAM_HOST) {
                    view.evaluateJavascript(calmScript, null)
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }

        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = callback
                return try {
                    filePicker.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    pendingFileCallback = null
                    false
                }
            }

            // Caméra / micro : seulement pour un appel, sur https://www.instagram.com/call/.
            // Partout ailleurs (stories, création, autres sites) : refusé.
            override fun onPermissionRequest(request: PermissionRequest) {
                val wanted = request.resources.filter {
                    it == PermissionRequest.RESOURCE_AUDIO_CAPTURE || it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                }
                if (!isCallPage(request.origin, view.url) || wanted.isEmpty()) {
                    request.deny()
                    return
                }
                val androidPermissions = wanted.map {
                    if (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO
                    else Manifest.permission.CAMERA
                }
                pendingMediaRequest?.deny()
                pendingMediaRequest = request
                pendingMediaResources = wanted
                mediaPermissions.launch(androidPermissions.toTypedArray())
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingMediaRequest == request) pendingMediaRequest = null
            }
        }
    }

    // Réponse d'Android : on n'accorde à la page que ce que tu as autorisé.
    private val mediaPermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            val request = pendingMediaRequest ?: return@registerForActivityResult
            pendingMediaRequest = null
            val granted = pendingMediaResources.filter {
                val permission = if (it == PermissionRequest.RESOURCE_AUDIO_CAPTURE) Manifest.permission.RECORD_AUDIO
                                 else Manifest.permission.CAMERA
                results[permission] == true ||
                    checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
            }
            if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
        }

    private fun isCallPage(origin: Uri?, pageUrl: String?): Boolean {
        if (origin?.scheme != "https" || origin.host != INSTAGRAM_HOST) return false
        return isCallUrl(pageUrl)
    }

    private fun isCallUrl(url: String?): Boolean {
        val page = url?.let(Uri::parse) ?: return false
        return page.host == INSTAGRAM_HOST && (page.path ?: "").startsWith("/call/")
    }

    // Retour depuis la page d'appel : on saute toutes les entrées /call/ de l'historique
    // (la page d'appel peut en ajouter) pour revenir directement à la conversation.
    // Quitter la page raccroche si l'appel est encore en cours.
    private fun leaveCallPage() {
        val history = webView.copyBackForwardList()
        var index = history.currentIndex - 1
        while (index >= 0 && isCallUrl(history.getItemAtIndex(index)?.url)) index--
        if (index >= 0) webView.goBackOrForward(index - history.currentIndex)
        else webView.loadUrl(INBOX_URL)
    }

    private fun isInAppHost(host: String?): Boolean =
        host != null && IN_APP_DOMAINS.any { host == it || host.endsWith(".$it") }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (e: ActivityNotFoundException) {
            // Aucun navigateur : on ne fait rien.
        }
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        // Pendant un appel, on laisse la page tourner pour ne pas couper le son
        // si tu passes sur une autre appli.
        if (!isCallPage(Uri.parse(INSTAGRAM_ORIGIN), webView.url)) webView.onPause()
        CookieManager.getInstance().flush() // garder la session après fermeture
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val INSTAGRAM_HOST = "www.instagram.com"
        const val INSTAGRAM_ORIGIN = "https://www.instagram.com"
        // calmfeed.js redirige vers le feed des abonnements si le réglage est activé.
        const val START_URL = "https://www.instagram.com/"
        const val SETTINGS_URL = "https://www.instagram.com/#calmgram"
        const val INBOX_URL = "https://www.instagram.com/direct/inbox/"
        const val ACTION_SETTINGS = "fr.perso.calmgram.SETTINGS"

        // Connexion, double authentification et vérifications peuvent passer par Facebook/Meta.
        val IN_APP_DOMAINS = listOf("instagram.com", "facebook.com", "meta.com")
    }
}
