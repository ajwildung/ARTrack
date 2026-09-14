// Runtime lab scene: Quest passthrough underlay + world-locked pads/gates.
// Play Mode in Editor uses EditorSimDriver (simulated poses). On device, OpenXR HMD pose is look.
using UnityEngine;

namespace VoltageLeague.M2
{
    public class QuestLabBootstrap : MonoBehaviour
    {
        public string wsUrl = "ws://127.0.0.1:8080/ws";
        public string kartId = "QUEST-1";

        VoltageSessionClient _session;
        WorldCompositor _compositor;
        EditorSimDriver _sim;
        bool _built;

        [System.Serializable]
        class SnapshotEnvelope
        {
            public string type;
            public TrackHolder snapshot;
        }

        [System.Serializable]
        class TrackHolder
        {
            public TrackSnapshot track;
            public KartFx[] karts;
        }

        [System.Serializable]
        class KartFx
        {
            public string id;
            public bool worldFxAllowed;
            public bool worldPoseHealthy;
            public string hideReason;
        }

        void Start()
        {
            BuildIfNeeded();
            _session.wsUrl = wsUrl;
            _session.kartId = kartId;
            _session.SnapshotJson += OnSnapshot;
            _session.AssistJson += OnAssist;
            _session.Connect();
        }

        void BuildIfNeeded()
        {
            if (_built) return;
            _built = true;

            if (Camera.main == null)
            {
                var camGo = new GameObject("LabCamera");
                camGo.tag = "MainCamera";
                camGo.AddComponent<Camera>();
                camGo.AddComponent<AudioListener>();
                camGo.transform.position = new Vector3(0f, 0.92f, 0f);
            }

            _session = gameObject.AddComponent<VoltageSessionClient>();
            _compositor = gameObject.AddComponent<WorldCompositor>();
            _sim = gameObject.AddComponent<EditorSimDriver>();
            _sim.session = _session;
            _sim.compositor = _compositor;
            _sim.editorCamera = Camera.main ? Camera.main.transform : null;

            // Placeholder oval so Editor Play shows *something* before the first snapshot.
            _compositor.Rebuild(new TrackSnapshot
            {
                pads = new[]
                {
                    new PadSnapshot { id = "pad-1", x = 46.5f, y = 0f, radiusM = 3.6f },
                    new PadSnapshot { id = "pad-2", x = 0f, y = 24f, radiusM = 3.6f },
                    new PadSnapshot { id = "pad-3", x = -46.5f, y = 0f, radiusM = 3.6f }
                },
                gates = new[]
                {
                    new GateSnapshot { id = "gate-sf", kind = "start_finish", x = 46.5f, y = 0f, headingRad = Mathf.PI / 2f, widthM = 5.2f, heightM = 3.2f }
                }
            });
        }

        void OnSnapshot(string json)
        {
            try
            {
                // hello_ok wraps snapshot; tolerate either envelope.
                var env = JsonUtility.FromJson<SnapshotEnvelope>(json);
                var track = env != null && env.snapshot != null ? env.snapshot.track : JsonUtility.FromJson<TrackHolder>(json)?.track;
                if (track != null && (track.pads != null || track.gates != null))
                    _compositor.Rebuild(track);
            }
            catch (System.Exception ex)
            {
                Debug.LogWarning("[Voltage] snapshot parse: " + ex.Message);
            }
        }

        void OnAssist(string json)
        {
            if (json.Contains("\"canTorqueNm\":") && !json.Contains("\"canTorqueNm\":null"))
                Debug.LogError("[Voltage] Phase 0 violation: physical assist on the wire. Ignore locally.");
            if (json.Contains("\"type\":\"cancel\"") || json.Contains("safeMode"))
                Debug.Log("[Voltage] visual cancel / safe mode — drop surge VFX");
        }
    }
}
