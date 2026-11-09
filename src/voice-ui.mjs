const stopIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';

export function setupVoiceInput({api,getContext,insertText,isBusy,notice,onStateChange=()=>{}}) {
  const $ = id => document.getElementById(id), microphone = $('microphone');
  const idleIcon = microphone.innerHTML;
  let stream,recorder,timer,limit,animation,audioContext,analyser;
  let phase='idle',generation=0,context,requestId,started=0;
  const waveform=$('voice-wave'),canvas=waveform.getContext('2d');
  let levels=Array(24).fill(0);

  function release() {
    clearInterval(timer);clearTimeout(limit);cancelAnimationFrame(animation);
    stream?.getTracks().forEach(track=>track.stop());stream=null;
    if(audioContext){void audioContext.close().catch(()=>{});audioContext=null;analyser=null;}
  }
  function sync() {
    if(phase!=='idle' && context && (context.conversationId!==getContext().conversationId||isBusy())){cancel();return;}
    const active=phase!=='idle',recording=phase==='recording';
    $('composer').dataset.voice=phase;
    $('voice-inline').hidden=!active;$('prompt').hidden=active;$('attach-menu').hidden=active;
    if(active){$('send').hidden=true;$('stop').hidden=true;$('voice-call').hidden=true;}
    microphone.hidden=false;microphone.disabled=phase==='starting'||phase==='transcribing'||(!active&&isBusy());
    microphone.innerHTML=recording?stopIcon:idleIcon;
    microphone.classList.toggle('is-recording',recording);microphone.setAttribute('aria-pressed',String(recording));
    microphone.setAttribute('aria-label',recording?'Stop recording':'Dictate a message');microphone.title=recording?'Stop recording':'Dictate a message';
    $('voice-status').textContent=recording?'Recording':phase==='transcribing'?'Transcribing…':'Starting microphone…';
    waveform.hidden=!recording;$('voice-timer').hidden=!recording;$('voice-progress').hidden=recording;
    $('voice-inline').setAttribute('aria-busy',String(phase==='starting'||phase==='transcribing'));
  }
  function setPhase(value){phase=value;sync();onStateChange();}
  function cancel() {
    generation++;release();
    const current=recorder;recorder=null;
    if(current?.state==='recording')current.stop();
    if(requestId)void api.cancelTranscription().catch(()=>{});
    requestId=null;context=null;setPhase('idle');
  }
  function draw() {
    if(phase!=='recording')return;
    const samples=new Uint8Array(analyser?.fftSize||256);let level=0;
    if(analyser){analyser.getByteTimeDomainData(samples);for(const sample of samples)level+=(sample-128)**2;level=Math.min(1,Math.sqrt(level/samples.length)/35);}
    levels.shift();levels.push(level);
    canvas.clearRect(0,0,waveform.width,waveform.height);canvas.strokeStyle=getComputedStyle(waveform).color;canvas.lineWidth=3;canvas.lineCap='round';
    const gap=waveform.width/levels.length;
    levels.forEach((value,index)=>{const height=3+value*(waveform.height-8),x=index*gap+gap/2;canvas.beginPath();canvas.moveTo(x,(waveform.height-height)/2);canvas.lineTo(x,(waveform.height+height)/2);canvas.stroke();});
    animation=requestAnimationFrame(draw);
  }
  function friendlyError(error) {
    const message=String(error?.message||error);
    if(/silent|no clear speech/i.test(message))return 'No speech detected. Try recording again.';
    if(/microphone|notallowed|permission/i.test(message))return 'Allow Gratis to use your microphone in System Settings → Privacy & Security → Microphone.';
    if(/too large|8 MB|two minutes/i.test(message))return 'Try a shorter recording.';
    // Setup problems (Whisper, its model or ffmpeg missing) need a fix, not a retry, so show them as written.
    const setup=message.match(/Voice input needs [^\n]*/);if(setup)return setup[0];
    return 'Could not transcribe that recording. Please try again.';
  }
  async function record() {
    if(phase!=='idle'||isBusy())return;
    const token=++generation;context=getContext();levels=Array(24).fill(0);$('notice').hidden=true;setPhase('starting');
    try {
      if(!await api.microphonePermission())throw new Error('Microphone permission denied');
      if(token!==generation)return;
      const audio=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(token!==generation){audio.getTracks().forEach(track=>track.stop());return;}
      stream=audio;
      const mimeType=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      if(!mimeType)throw new Error('Recording format unavailable');
      const chunks=[];let bytes=0;
      recorder=new MediaRecorder(stream,{mimeType,audioBitsPerSecond:64000});
      recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;}if(bytes>8*1024*1024&&recorder?.state==='recording')recorder.stop();};
      recorder.onerror=()=>{if(token!==generation)return;cancel();notice('Recording stopped unexpectedly. Please try again.');};
      recorder.onstop=async()=>{
        release();if(token!==generation)return;
        recorder=null;setPhase('transcribing');
        try {
          if(bytes>8*1024*1024)throw new Error('Recording too large');
          const blob=new Blob(chunks,{type:mimeType});
          const audioBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
          if(token!==generation)return;
          requestId=crypto.randomUUID();
          const result=await api.transcribeAudio({requestId,audioBase64,mimeType});
          if(token!==generation)return;
          const target=context;requestId=null;context=null;setPhase('idle');
          if(insertText(result.text,target)&&result.warning)notice(result.fallback?result.warning:'Your transcript is ready. Some punctuation may need a quick check.');
        } catch(error) {
          if(token!==generation)return;
          requestId=null;context=null;setPhase('idle');notice(friendlyError(error));
        }
      };
      started=Date.now();
      const tick=()=>{const seconds=Math.floor((Date.now()-started)/1000);$('voice-timer').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
      recorder.start(500);setPhase('recording');tick();timer=setInterval(tick,250);
      limit=setTimeout(stop,120000);
      try{audioContext=new AudioContext();analyser=audioContext.createAnalyser();analyser.fftSize=256;audioContext.createMediaStreamSource(stream).connect(analyser);void audioContext.resume().catch(()=>{});}catch{}
      draw();
    } catch(error) {
      if(token!==generation)return;
      release();recorder=null;context=null;setPhase('idle');notice(friendlyError(error));
    }
  }
  function stop(){if(phase==='recording'&&recorder?.state==='recording')recorder.stop();}
  microphone.onclick=()=>phase==='recording'?stop():void record();
  $('voice-call').onclick=()=>void record();$('voice-cancel').onclick=()=>{cancel();$('prompt').focus();};
  document.addEventListener('keydown',event=>{if(phase!=='idle'&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();$('prompt').focus();}},true);
  window.addEventListener('beforeunload',cancel);
  window.addEventListener('blur',()=>{if(phase==='recording')stop();});
  return {cancel,sync,get active(){return phase!=='idle';}};
}
