/** Home Assistant announcer: speaks text on a media player through a TTS entity. */
export function makeAnnouncer({ url, token, ttsEntity, mediaPlayer, fetchImpl = fetch } = {}) {
  const configured = !!(url && token && ttsEntity && mediaPlayer);
  return {
    configured,
    async announce(text) {
      if (!configured) return { configured: false };
      const res = await fetchImpl(`${url.replace(/\/$/, '')}/api/services/tts/speak`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_id: ttsEntity, media_player_entity_id: mediaPlayer, message: text }),
      });
      if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
      return { configured: true };
    },
  };
}
