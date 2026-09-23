import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useSpaceRuntime } from './digital-life/space/useSpaceRuntime';
import { SpaceControls } from './digital-life/space/SpaceControls';
import type { SpaceDefinition } from '@mybrandos/shared';
import { AdaptiveVideoPlayer } from './media/AdaptiveVideoPlayer';
import { useRevealDoubleTap } from './digital-life/personal-os/useRevealDoubleTap';
import './styles.css';

// Development-only, user-authorized mock data. Never a tenant/catalog record.
if (!import.meta.env.DEV) throw new Error('Space fixture is development-only');
const spaces: SpaceDefinition[] = ['fixture.alpha', 'fixture.beta'].map(id => ({
  id, owner: 'test-only', defaultExperienceId: 'APP',
  experiences: ['APP', 'TV', 'RADIO'].map(id => ({ id, title: id, type: id, lifecyclePolicy: 'retained', offlinePolicy: 'cached' })),
}));
async function mockMedia(): Promise<string> {
  const cache = await caches.open('space-contract-test-media-v1');
  const key = new URL('/__space-contract-test-media__.webm', location.origin).href;
  const existing = await cache.match(key);
  if (existing) return URL.createObjectURL(await existing.blob());
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d')!;
  const stream = canvas.captureStream(24);
  const audio = new AudioContext();
  await audio.resume();
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.025;
  const output = audio.createMediaStreamDestination();
  tone.connect(gain).connect(output);
  tone.frequency.value = 220; tone.start();
  stream.addTrack(output.stream.getAudioTracks()[0]);
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
  const done = new Promise<Blob>(resolve => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });
  let frame = 0;
  const timer = window.setInterval(() => {
    context.fillStyle = '#123a52'; context.fillRect(0,0,640,360);
    context.fillStyle = '#8ce5d1'; context.fillRect((frame * 5) % 580,160,60,60);
    context.font = '24px sans-serif'; context.fillText('MOCK MEDIA — SPACE CONTRACT TEST',24,60);
    context.fillText('Frame ' + frame++,24,110);
  }, 1000 / 24);
  recorder.start();
  await new Promise(resolve => window.setTimeout(resolve,8000));
  recorder.stop();
  const blob = await done;
  clearInterval(timer); tone.stop(); stream.getTracks().forEach(track => track.stop()); await audio.close();
  await cache.put(key, new Response(blob));
  return URL.createObjectURL(blob);
}
function Player({src,active,id}:{src:string;active:boolean;id:string}) {
  return <AdaptiveVideoPlayer src={src} presentation="WATCH" title={id} active={active} autoPlayMuted={active} loop maxPlays={0} fillViewport />;
}
function Fixture() {
  const [src,setSrc] = useState('');
  const [status,setStatus] = useState('Mock fixture only. No production records are changed.');
  const [visited,setVisited] = useState(['fixture.alpha/APP']);
  const runtime = useSpaceRuntime(spaces[0], (experienceId,spaceId) => {
    setVisited(previous => [...new Set([...previous,spaceId + '/' + experienceId])]);
  }, true, spaces);
  const root = useRef<HTMLDivElement>(null);
  useRevealDoubleTap(true, () => runtime.dispatch({type:'DOUBLE_TAP_CANVAS'}), '[data-canvas]', true);
  const [telemetry,setTelemetry] = useState('');
  useEffect(() => {
    let serial = 0;
    const ids = new WeakMap<Element,number>();
    const loads = new WeakMap<Element,number>();
    const tick = () => {
      const nodes = [...(root.current?.querySelectorAll<HTMLMediaElement>('video,audio') ?? [])];
      const rows = nodes.map(media => {
        if (!ids.has(media)) {
          ids.set(media,++serial); loads.set(media,0);
          media.addEventListener('loadedmetadata',() => loads.set(media,(loads.get(media)||0)+1));
        }
        const rect = media.getBoundingClientRect();
        return {id:media.closest('[data-experience]')?.getAttribute('data-experience'),node:ids.get(media),
          time:Number(media.currentTime.toFixed(3)),paused:media.paused,muted:media.muted,
          loads:loads.get(media),width:rect.width,height:rect.height,x:rect.x,y:rect.y};
      });
      setTelemetry(JSON.stringify({count:rows.length,playing:rows.filter(row=>!row.paused).length,rows}));
    };
    const timer = window.setInterval(tick,200);
    return () => window.clearInterval(timer);
  },[]);
  const active = runtime.state.currentSpaceId + '/' + runtime.state.currentExperienceId;
  return <div ref={root} data-fixture="space-contract-v1">
    <header><strong>TEST FIXTURE — mybrandOS</strong> <span>{status}</span>
      {!src ? <button onClick={async () => {
        setStatus('Preparing 8-second mock video and tone...');
        try { setSrc(await mockMedia()); setStatus('Cached mock media ready.'); }
        catch(error) { setStatus(String(error)); }
      }}>Prepare mock media</button> : null}
    </header>
    <div data-canvas="true" style={{position:'relative',width:'100%',height:'calc(100vh - 140px)',background:'#061923'}}>
      {src ? visited.map(id => <section key={id} data-experience={id} aria-hidden={id!==active}
        style={{position:'absolute',inset:0,visibility:id===active?'visible':'hidden',pointerEvents:id===active?'auto':'none'}}>
        <Player src={src} active={id===active} id={id}/>
      </section>) : null}
      {runtime.state.presentationState==='INTERACTION' ? <aside aria-label="Fixture interactions"
        style={{position:'absolute',right:0,top:0,bottom:0,width:220,background:'#122a38aa',color:'white'}}>
        Mock interaction overlay; the player underneath is retained.
      </aside> : null}
    </div>
    <SpaceControls state={runtime.state} definition={runtime.definition} dispatch={runtime.dispatch}>
      <button onClick={() => runtime.dispatch({type:'REVOLVE',spaceId:runtime.state.currentSpaceId===spaces[0].id?spaces[1].id:spaces[0].id})}>Revolve fixture Space</button>
    </SpaceControls>
    <output id="runtime-state">{JSON.stringify({space:runtime.state.currentSpaceId,experience:runtime.state.currentExperienceId,state:runtime.state.presentationState,pinned:runtime.state.handlePinned,persistentUI:runtime.state.persistentUI})}</output>
    <output id="media-telemetry" style={{display:'block',fontSize:10,overflowWrap:'anywhere'}}>{telemetry}</output>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
