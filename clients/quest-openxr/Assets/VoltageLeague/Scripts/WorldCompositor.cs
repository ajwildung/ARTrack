// World compositor: pads/gates as WORLD-SPACE meshes (not camera-locked HUD).
// Fail-safe: disable the world root when kart world pose is unhealthy.
using System.Collections.Generic;
using UnityEngine;

namespace VoltageLeague.M2
{
    public class WorldCompositor : MonoBehaviour
    {
        [Tooltip("Parent for registered pads/gates. Never parent this to the HMD camera.")]
        public Transform worldRoot;
        public Material padMaterial;
        public Material gateMaterial;

        readonly List<GameObject> spawned = new List<GameObject>();

        public void Rebuild(TrackSnapshot track)
        {
            Clear();
            if (worldRoot == null)
            {
                var go = new GameObject("WorldFxRoot");
                worldRoot = go.transform;
                worldRoot.SetParent(transform, false);
            }

            if (track?.pads != null)
            {
                foreach (var pad in track.pads)
                {
                    var disc = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                    disc.name = pad.id;
                    disc.transform.SetParent(worldRoot, false);
                    disc.transform.position = new Vector3(pad.x, 0.04f, pad.y);
                    disc.transform.localScale = new Vector3(pad.radiusM * 2f, 0.04f, pad.radiusM * 2f);
                    ApplyMat(disc, padMaterial, new Color(0.18f, 0.9f, 1f, 0.55f));
                    spawned.Add(disc);
                }
            }

            if (track?.gates != null)
            {
                foreach (var gate in track.gates)
                {
                    spawned.Add(MakePost(gate, -1));
                    spawned.Add(MakePost(gate, 1));
                    spawned.Add(MakeLintel(gate));
                }
            }
        }

        public void SetWorldFxAllowed(bool allowed, string hideReason)
        {
            if (worldRoot) worldRoot.gameObject.SetActive(allowed);
            if (!allowed)
                Debug.Log($"[Voltage] WORLD FX HIDDEN ({hideReason}). Kart world pose unhealthy — not a HUD fallback.");
        }

        GameObject MakePost(GateSnapshot gate, int side)
        {
            var yaw = gate.headingRad;
            var right = new Vector3(Mathf.Sin(yaw), 0f, -Mathf.Cos(yaw));
            var pos = new Vector3(gate.x, gate.heightM * 0.5f, gate.y) + right * (gate.widthM * 0.5f * side);
            var post = GameObject.CreatePrimitive(PrimitiveType.Cube);
            post.name = gate.id + (side < 0 ? "_L" : "_R");
            post.transform.SetParent(worldRoot, false);
            post.transform.position = pos;
            post.transform.localScale = new Vector3(0.12f, gate.heightM, 0.12f);
            ApplyMat(post, gateMaterial, gate.kind == "start_finish" ? Color.white : new Color(0.18f, 0.9f, 1f));
            return post;
        }

        GameObject MakeLintel(GateSnapshot gate)
        {
            var yaw = gate.headingRad;
            var lintel = GameObject.CreatePrimitive(PrimitiveType.Cube);
            lintel.name = gate.id + "_lintel";
            lintel.transform.SetParent(worldRoot, false);
            lintel.transform.position = new Vector3(gate.x, gate.heightM, gate.y);
            lintel.transform.rotation = Quaternion.Euler(0f, yaw * Mathf.Rad2Deg, 0f);
            lintel.transform.localScale = new Vector3(gate.widthM, 0.12f, 0.12f);
            ApplyMat(lintel, gateMaterial, gate.kind == "start_finish" ? Color.white : new Color(0.18f, 0.9f, 1f));
            return lintel;
        }

        static void ApplyMat(GameObject go, Material mat, Color color)
        {
            var r = go.GetComponent<Renderer>();
            if (mat) r.sharedMaterial = mat;
            else r.material.color = color;
        }

        void Clear()
        {
            foreach (var go in spawned)
                if (go) Destroy(go);
            spawned.Clear();
        }
    }

    [System.Serializable]
    public class TrackSnapshot
    {
        public PadSnapshot[] pads;
        public GateSnapshot[] gates;
    }

    [System.Serializable]
    public class PadSnapshot
    {
        public string id;
        public float x, y, radiusM;
    }

    [System.Serializable]
    public class GateSnapshot
    {
        public string id;
        public string kind;
        public float x, y, headingRad, widthM, heightM;
    }
}
