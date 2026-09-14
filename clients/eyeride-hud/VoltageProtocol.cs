// Voltage League M1 — protocol envelope for a future Unity + OpenXR visor client.
// Not compiled here. Phase 0: visual telegraphs only.
using System;

namespace VoltageLeague.M1
{
    public static class Phase
    {
        public const int Current = 0;
        public const bool PhysicalAssistEnabled = false;
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
        public string type; // surge | pickup_defensive | pickup_pace | use_* | cancel
        public int durationMs;
    }
}
