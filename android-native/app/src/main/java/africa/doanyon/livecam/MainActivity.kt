package africa.doanyon.livecam

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import okhttp3.*
import org.json.JSONObject
import org.webrtc.*

class MainActivity : AppCompatActivity() {
    private lateinit var egl: EglBase
    private lateinit var factory: PeerConnectionFactory
    private lateinit var preview: SurfaceViewRenderer
    private lateinit var status: TextView
    private lateinit var address: EditText
    private lateinit var hd: CheckBox
    private lateinit var startBtn: Button
    private val http = OkHttpClient()
    private val ui = Handler(Looper.getMainLooper())
    private var capturer: CameraVideoCapturer? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var pc: PeerConnection? = null
    private var ws: WebSocket? = null
    private var running = false

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 24, 24, 24) }
        address = EditText(this).apply { hint = "ws://192.168.x.x:3000/ws"; setText("ws://192.168.1.10:3000/ws"); setSingleLine() }
        hd = CheckBox(this).apply { text = "1080p (sinon 720p)" }
        startBtn = Button(this).apply { text = "Démarrer le direct"; setOnClickListener { toggle() } }
        val flip = Button(this).apply { text = "Changer de caméra"; setOnClickListener { capturer?.switchCamera(null) } }
        status = TextView(this).apply { text = "Prêt" }
        preview = SurfaceViewRenderer(this)
        root.addView(address); root.addView(hd); root.addView(startBtn); root.addView(flip); root.addView(status)
        root.addView(preview, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)

        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions())
        egl = EglBase.create()
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
        preview.init(egl.eglBaseContext, null)
        preview.setMirror(false)
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO), 1)
    }

    private fun toggle() {
        if (running) { stop(); return }
        val ok = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO).all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }
        if (!ok) { status.text = "Autorisez caméra et micro"; return }
        running = true; startBtn.text = "Arrêter le direct"
        startCapture(); connect()
    }

    private fun startCapture() {
        val en = Camera2Enumerator(this)
        val name = en.deviceNames.firstOrNull { en.isBackFacing(it) } ?: en.deviceNames.first()
        capturer = en.createCapturer(name, null)
        val helper = SurfaceTextureHelper.create("cap", egl.eglBaseContext)
        val src = factory.createVideoSource(false)
        capturer!!.initialize(helper, this, src.capturerObserver)
        if (hd.isChecked) capturer!!.startCapture(1920, 1080, 30) else capturer!!.startCapture(1280, 720, 30)
        videoTrack = factory.createVideoTrack("v0", src).also { it.addSink(preview) }
        audioTrack = factory.createAudioTrack("a0", factory.createAudioSource(MediaConstraints()))
    }

    private fun connect() {
        if (!running) return
        ws = http.newWebSocket(Request.Builder().url(address.text.toString().trim()).build(), object : WebSocketListener() {
            override fun onOpen(w: WebSocket, r: Response) {
                w.send("""{"type":"join","role":"publisher","room":"main"}""")
                ui.post { status.text = "Connecté au PC, en attente d'OBS…" }
            }
            override fun onMessage(w: WebSocket, text: String) = handle(JSONObject(text))
            override fun onFailure(w: WebSocket, t: Throwable, r: Response?) {
                ui.post { status.text = "Connexion perdue, nouvelle tentative…" }
                ui.postDelayed({ connect() }, 2000)
            }
        })
    }

    private fun send(o: JSONObject) { ws?.send(o.toString()) }

    private fun handle(m: JSONObject) {
        when (m.getString("type")) {
            "viewer-joined" -> startPeer()
            "answer" -> pc?.setRemoteDescription(Sdp(), SessionDescription(SessionDescription.Type.ANSWER, m.getString("sdp")))
            "candidate" -> m.getJSONObject("candidate").let {
                pc?.addIceCandidate(IceCandidate(it.optString("sdpMid"), it.optInt("sdpMLineIndex"), it.getString("candidate"))) }
            "viewer-left" -> { pc?.close(); pc = null; ui.post { status.text = "OBS déconnecté" } }
        }
    }

    private fun startPeer() {
        pc?.close()
        val cfg = PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        pc = factory.createPeerConnection(cfg, object : Obs() {
            override fun onIceCandidate(c: IceCandidate) {
                send(JSONObject().put("type", "candidate").put("candidate",
                    JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex)))
            }
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {
                ui.post { status.text = if (s == PeerConnection.IceConnectionState.CONNECTED) "EN DIRECT vers OBS" else "Connexion : $s" }
            }
        })!!
        val sender = pc!!.addTrack(videoTrack, listOf("s"))
        pc!!.addTrack(audioTrack, listOf("s"))
        val p = sender.parameters
        p.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
        p.encodings.forEach { it.maxBitrateBps = if (hd.isChecked) 6_000_000 else 4_000_000; it.maxFramerate = 30 }
        sender.setParameters(p)
        pc!!.createOffer(object : Sdp() {
            override fun onCreateSuccess(d: SessionDescription) {
                pc?.setLocalDescription(Sdp(), d)
                send(JSONObject().put("type", "offer").put("sdp", d.description))
            }
        }, MediaConstraints())
    }

    private fun stop() {
        running = false; startBtn.text = "Démarrer le direct"; status.text = "Arrêté"
        ws?.close(1000, null); pc?.close(); pc = null
        try { capturer?.stopCapture() } catch (_: Exception) {}
        videoTrack?.removeSink(preview)
    }

    override fun onDestroy() { stop(); preview.release(); super.onDestroy() }

    open class Sdp : SdpObserver {
        override fun onCreateSuccess(d: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(e: String?) {}
        override fun onSetFailure(e: String?) {}
    }
    open class Obs : PeerConnection.Observer {
        override fun onSignalingChange(s: PeerConnection.SignalingState) {}
        override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {}
        override fun onIceConnectionReceivingChange(b: Boolean) {}
        override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
        override fun onIceCandidate(c: IceCandidate) {}
        override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) {}
        override fun onAddStream(s: MediaStream) {}
        override fun onRemoveStream(s: MediaStream) {}
        override fun onDataChannel(d: DataChannel) {}
        override fun onRenegotiationNeeded() {}
    }
}
