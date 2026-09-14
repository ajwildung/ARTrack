// Voltage League M2 — Quest OpenXR lab client (Unity).
// Protocol + Phase 0 visual-only gate. Not compiled by the Node workspace.
using System;

namespace VoltageLeague.M2
{
    public static class Phase
    {
        public const int Current = 0;
        public const bool PhysicalAssistEnabled = false;
        public const string LabDisplay = "quest_openxr_passthrough";
        public const string ProductDisplay = "waveguide_partner_future";
        public const bool EyeRidePath = false;
    }

    [Serializable]
    public class Pose3
    {
        public string kartId;
        public string frame = "track_local";
        public float x, y, z;
        public float yawRad, pitchRad, rollRad;
        public float speedMps;
        public string provider;
        public float quality = 1f;
        public long ts;
    }

    [Serializable]
    public class DualPoseSample
    {
        public string kartId;
        public Pose3 kartWorld;
        public Pose3 look;
        public string lookSource; // hmd_slam | helmet_vio | sim | none
    }

    [Serializable]
    public class VisualAssist
    {
        public int phase = 0;
        public string channel = "visual";
        public bool actuatorPresent = false;
        public string physicalOffset = null;
        public string canTorqueNm = null;
        public string motorOverlay = null;
        public Vfx vfx;
    }

    [Serializable]
    public class Vfx
    {
        public string type;
        public int durationMs;
    }
}
