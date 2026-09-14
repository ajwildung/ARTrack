// Track-LAN WebSocket client. Phase 0: consume visual assist only; never apply motor/CAN.
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace VoltageLeague.M2
{
    public class VoltageSessionClient : MonoBehaviour
    {
        [Tooltip("ws://<lan-host>:8080/ws")]
        public string wsUrl = "ws://127.0.0.1:8080/ws";
        public string kartId = "QUEST-1";
        public string displayName = "Quest Lab";

        public event Action<string> SnapshotJson;
        public event Action<string> AssistJson;

        ClientWebSocket _ws;
        CancellationTokenSource _cts;
        readonly byte[] _buf = new byte[1 << 16];

        public bool Connected => _ws != null && _ws.State == WebSocketState.Open;

        public async void Connect()
        {
            await Disconnect();
            _cts = new CancellationTokenSource();
            _ws = new ClientWebSocket();
            try
            {
                await _ws.ConnectAsync(new Uri(wsUrl), _cts.Token);
                await SendJson("{\"type\":\"hello\",\"role\":\"headset\",\"kartId\":\"" + Escape(kartId) + "\",\"name\":\"" + Escape(displayName) + "\"}");
                _ = ReceiveLoop();
                Debug.Log("[Voltage] headset hello ok → " + wsUrl);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Voltage] WS connect failed (Editor sim still runs locally): " + ex.Message);
            }
        }

        async Task ReceiveLoop()
        {
            var acc = new StringBuilder();
            while (_ws != null && _ws.State == WebSocketState.Open && !_cts.IsCancellationRequested)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(_buf), _cts.Token);
                acc.Append(Encoding.UTF8.GetString(_buf, 0, result.Count));
                if (!result.EndOfMessage) continue;
                var json = acc.ToString();
                acc.Clear();
                if (json.Contains("\"type\":\"assist\"")) AssistJson?.Invoke(json);
                if (json.Contains("\"type\":\"snapshot\"") || json.Contains("\"type\":\"hello_ok\""))
                    SnapshotJson?.Invoke(json);
            }
        }

        public Task SendDualPose(DualPoseSample sample)
        {
            var json = JsonUtility.ToJson(new DualPoseEnvelope { type = "dual_pose", sample = sample });
            return SendJson(json);
        }

        public Task SendSteer(float throttle, float steer)
        {
            return SendJson("{\"type\":\"steer\",\"kartId\":\"" + Escape(kartId) + "\",\"throttle\":" + throttle + ",\"steer\":" + steer + "}");
        }

        async Task SendJson(string json)
        {
            if (_ws == null || _ws.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
        }

        public async Task Disconnect()
        {
            try
            {
                _cts?.Cancel();
                if (_ws != null && _ws.State == WebSocketState.Open)
                    await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
            }
            catch { /* ignore */ }
            _ws?.Dispose();
            _ws = null;
        }

        void OnDestroy() { _ = Disconnect(); }

        static string Escape(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");

        [Serializable]
        class DualPoseEnvelope
        {
            public string type;
            public DualPoseSample sample;
        }
    }
}
