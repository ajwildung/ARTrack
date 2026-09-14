// Dual-pose fusion: KartVio (world) + HelmetVio / HmdSlam (look).
// World FX require a healthy kart/world pose. Mirrors packages/shared/src/compositor.ts.
using UnityEngine;

namespace VoltageLeague.M2
{
    public struct FusionCalib
    {
        public float seatForwardM;
        public float seatUpM;
        public float seatRightM;

        public static FusionCalib Default => new FusionCalib
        {
            seatForwardM = 0.18f,
            seatUpM = 0.92f,
            seatRightM = 0f
        };
    }

    public struct FusedPose
    {
        public bool kartWorldHealthy;
        public bool worldFxAllowed;
        public string hideReason;
        public Pose3 worldAnchor;
        public Pose3 hmdInWorld;
        public float quality;
    }

    public static class DualPoseFusion
    {
        public const float MinQuality = 0.45f;
        public const long MaxAgeMs = 400;

        public static FusedPose Fuse(DualPoseSample sample, long nowMs, FusionCalib calib)
        {
            var fused = new FusedPose { hideReason = "ok", quality = sample?.kartWorld != null ? sample.kartWorld.quality : 0f };
            if (sample == null || sample.kartWorld == null)
            {
                fused.hideReason = "no_kart_world_pose";
                return fused;
            }

            var kart = sample.kartWorld;
            if (kart.quality < MinQuality) fused.hideReason = "low_quality";
            else if (nowMs - kart.ts > MaxAgeMs) fused.hideReason = "stale";
            else fused.kartWorldHealthy = true;

            fused.worldAnchor = kart;
            fused.worldFxAllowed = fused.kartWorldHealthy;
            fused.hmdInWorld = ApplyLook(OffsetSeat(kart, calib), sample.look);
            if (!fused.kartWorldHealthy && fused.hideReason == "ok") fused.hideReason = "kart_world_unhealthy";
            return fused;
        }

        static Pose3 OffsetSeat(Pose3 kart, FusionCalib calib)
        {
            var yaw = kart.yawRad;
            var forward = new Vector3(Mathf.Cos(yaw), 0f, Mathf.Sin(yaw));
            var up = Vector3.up;
            var right = Vector3.Cross(forward, up).normalized;
            var p = new Vector3(kart.x, kart.y, kart.z)
                    + forward * calib.seatForwardM
                    + up * calib.seatUpM
                    + right * calib.seatRightM;
            return CloneAt(kart, p, kart.yawRad, 0f, 0f);
        }

        static Pose3 ApplyLook(Pose3 seat, Pose3 look)
        {
            if (look == null) return seat;
            if (look.frame == "track_local") return look;
            return CloneAt(seat, new Vector3(seat.x, seat.y, seat.z),
                seat.yawRad + look.yawRad, look.pitchRad, look.rollRad);
        }

        static Pose3 CloneAt(Pose3 src, Vector3 p, float yaw, float pitch, float roll)
        {
            return new Pose3
            {
                kartId = src.kartId,
                frame = "track_local",
                x = p.x,
                y = p.y,
                z = p.z,
                yawRad = yaw,
                pitchRad = pitch,
                rollRad = roll,
                speedMps = src.speedMps,
                provider = src.provider,
                quality = src.quality,
                ts = src.ts
            };
        }

        public static Quaternion Rotation(Pose3 p)
        {
            return Quaternion.Euler(p.pitchRad * Mathf.Rad2Deg, p.yawRad * Mathf.Rad2Deg, p.rollRad * Mathf.Rad2Deg);
        }

        public static Vector3 Position(Pose3 p) => new Vector3(p.x, p.y, p.z);
    }
}
