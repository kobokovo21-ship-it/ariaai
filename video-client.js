// video-client.js
// Frontend-Helfer. IDENTISCH nutzbar in Business- und Makler-UI.
// userId/plan kommen aus deinem bestehenden User-/Auth-Context.

export async function generateVideo({ userId, plan, workspace, prompt, imageUrl }) {
  const res = await fetch('/api/generate-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, plan, workspace, prompt, imageUrl }),
  });

  const data = await res.json();

  if (!res.ok) {
    // Gesperrt oder Limit erreicht -> dasselbe Upgrade-Modal wie bei deinen
    // anderen Tools auslösen.
    if (data.error === 'locked' || data.error === 'limit_reached') {
      // ⚠️ WIRE-UP 3: deine bestehende Modal-Funktion einsetzen:
      window.showUpgradeModal?.(data.message);
      return null;
    }
    throw new Error(data.message || data.error || 'Video-Generierung fehlgeschlagen');
  }

  return data.videoUrl;
}

/* --------------------------------------------------------------------
   BEISPIEL: Button-Komponente (React). Funktioniert in beiden Apps.
   In der Makler-App workspace="makler", in der Business-App "business".
---------------------------------------------------------------------- */
//
// import { useState } from 'react';
// import { generateVideo } from './video-client';
//
// export function VideoButton({ user, workspace }) {
//   const [prompt, setPrompt] = useState('');
//   const [videoUrl, setVideoUrl] = useState(null);
//   const [loading, setLoading] = useState(false);
//
//   async function handleClick() {
//     setLoading(true);
//     try {
//       const url = await generateVideo({
//         userId: user.id,        // ⚠️ WIRE-UP 2: aus deinem User-Context
//         plan: user.plan,        //    'free' | 'pro' | 'premium'
//         workspace,
//         prompt,
//       });
//       if (url) setVideoUrl(url);
//     } catch (e) {
//       alert(e.message);
//     } finally {
//       setLoading(false);
//     }
//   }
//
//   return (
//     <div>
//       <textarea
//         value={prompt}
//         onChange={(e) => setPrompt(e.target.value)}
//         placeholder="Beschreibe das Werbevideo …"
//       />
//       <button onClick={handleClick} disabled={loading || !prompt}>
//         {loading ? 'Erstelle Video …' : 'Video erstellen'}
//       </button>
//       {videoUrl && <video src={videoUrl} controls style={{ width: '100%' }} />}
//     </div>
//   );
// }
