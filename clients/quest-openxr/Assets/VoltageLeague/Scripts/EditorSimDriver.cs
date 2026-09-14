// Unity Editor / no-HMD path: simulated KartVio + look. Same compositor as device.
using System;
using UnityEngine;

namespace VoltageLeague.M2
{
    public class EditorSimDriver : MonoBehaviour
    {
        public VoltageSessionClient session;
        public WorldCompositor compositor;
        public Transform editorCamera;
        public bool simulateUnhealthyKartPose;

        float _theta;
        DualPoseSample _sample;

        void Awake()
        {
            _sample = new DualPoseSample
            {
                kartId = session ? session.kartId : "QUEST-1",
                kartWorld = new Pose3 { kartId = session ? session.kartId : "QUEST-1", frame = "track_local", provider = "stub", quality = 1f },
                look = new Pose3 { kartId = session ? session.kartId : "QUEST-1", frame = "kart_body", provider = "hmd_slam", quality = 1f },
                lookSource = "hmd_slam"
            };
        }

        void Update()
        {
            var dt = Time.deltaTime;
            var throttle = Input.GetAxisRaw("Vertical");
            var steer = Input.GetAxisRaw("Horizontal");
            _theta += (throttle * 12f + 3f) * dt * 0.04f;
            var rx = 46.5f;
            var ry = 24f;
            var x = rx * Mathf.Cos(_theta);
            var z = ry * Mathf.Sin(_theta);
            var tx = -rx * Mathf.Sin(_theta);
            var ty = ry * Mathf.Cos(_theta);
            var yaw = Mathf.Atan2(ty, tx);

            var lookYaw = editorCamera ? editorCamera.eulerAngles.y * Mathf.Deg2Rad - yaw : 0f;
            var lookPitch = editorCamera ? -editorCamera.eulerAngles.x * Mathf.Deg2Rad : -0.08f;
            if (Input.GetMouseButton(1) && editorCamera)
            {
                editorCamera.Rotate(-Input.GetAxis("Mouse Y") * 1.6f, Input.GetAxis("Mouse X") * 1.6f, 0f, Space.Self);
            }

            var now = (long)(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            _sample.kartWorld.x = x;
            _sample.kartWorld.y = 0;
            _sample.kartWorld.z = z;
            _sample.kartWorld.yawRad = yaw;
            _sample.kartWorld.ts = now;
            _sample.kartWorld.provider = simulateUnhealthyKartPose ? "kart_vio" : "stub";
            _sample.kartWorld.quality = simulateUnhealthyKartPose ? 0.12f : 1f;
            _sample.look.yawRad = lookYaw;
            _sample.look.pitchRad = lookPitch;
            _sample.look.ts = now;

            var fused = DualPoseFusion.Fuse(_sample, now, FusionCalib.Default);
            if (editorCamera && fused.hmdInWorld != null)
            {
                editorCamera.position = DualPoseFusion.Position(fused.hmdInWorld);
                // Look is driven by the editor camera itself in Play mode; don't fight it.
            }
            compositor?.SetWorldFxAllowed(fused.worldFxAllowed, fused.hideReason);

            if (session && session.Connected)
            {
                _ = session.SendSteer(throttle, steer);
                _ = session.SendDualPose(_sample);
            }
        }
    }
}
