/* Rayzia Remote MCP browser bridge.
   Paste this into the Rayzia editor DevTools console.
   Optional before pasting:
     window.__RAYZIA_REMOTE_URL = 'https://YOUR-DOMAIN/api';
*/
(function () {
  var SERVER = window.__RAYZIA_REMOTE_URL || 'https://rayzia-remote-mcp-hyouka1.vercel.app/api';
  var w2 = window.__skiavgW2, host = w2 && w2.host;
  if (!host) {
    console.error('[rayzia-remote-mcp] window.__skiavgW2.host not found — open rayzia.com/vector and wait for the editor.');
    return;
  }
  if (window.__rayziaRemoteBridge) {
    try { window.__rayziaRemoteBridge.stop(); } catch (e) {}
  }

  var waiters = {};
  var seq = 0;
  var stopped = false;

  host.onState(function (m) {
    if (!m || !m.type) return;
    if (m.type === 'svl-catalog' && waiters[m.reqId]) waiters[m.reqId]({ catalog:m.catalog });
    else if (m.type === 'svl-state' && waiters[m.reqId]) waiters[m.reqId]({ state:m.state });
    else if (m.type === 'svl-result' && waiters[m.reqId]) waiters[m.reqId]({ result:m.result });
    else if (m.type === 'svl-tape' && waiters['tape:' + m.reqId]) waiters['tape:' + m.reqId]({ tape:m.tape });
    else if (m.type === 'export-svg-result' && waiters.export) waiters.export({ svg:m.svg,w:m.w,h:m.h });
    else if (m.type === 'replay-done' && waiters.replay) waiters.replay({ok:true});
    else if (m.type === 'bugshot-result' && waiters.bugshot) waiters.bugshot({px:m.px,w:m.w,h:m.h,error:m.error});
  });

  function reply(reqId,payload){
    fetch(SERVER + '/reply',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(Object.assign({reqId:reqId},payload))
    }).catch(function(){});
  }

  function wait(key,fire,ms){
    return new Promise(function(resolve){
      waiters[key]=function(p){delete waiters[key];resolve(p);};
      try{fire();}catch(e){delete waiters[key];resolve({error:String(e&&e.message||e)});return;}
      setTimeout(function(){
        if(waiters[key]){delete waiters[key];resolve({error:'timeout'});}
      },ms||12000);
    });
  }

  function settle(ms){return new Promise(function(r){setTimeout(r,ms||150);});}

  function encodePng(px,w,h,maxEdge){
    var c=document.createElement('canvas');
    c.width=w;c.height=h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px),w,h),0,0);
    var sw=w,sh=h,m=Math.max(w,h);
    if(m>maxEdge){var k=maxEdge/m;sw=Math.max(1,Math.round(w*k));sh=Math.max(1,Math.round(h*k));}
    var c2=document.createElement('canvas');
    c2.width=sw;c2.height=sh;
    c2.getContext('2d').drawImage(c,0,0,sw,sh);
    return {image:c2.toDataURL('image/png').split(',')[1],w:sw,h:sh};
  }

  async function handle(op){
    var rid=op.reqId,x;
    try{
      if(op.kind==='catalog'){
        x='r'+(++seq);
        reply(rid,await wait(x,function(){host.runCommand('SVL_CATALOG',{reqId:x});}));
      }else if(op.kind==='state'){
        x='r'+(++seq);
        reply(rid,await wait(x,function(){host.runCommand('SVL_STATE',{reqId:x});}));
      }else if(op.kind==='verb'){
        x='r'+(++seq);
        reply(rid,await wait(x,function(){host.runCommand('SVL_INVOKE',{reqId:x,verb:op.verb,args:op.args||{}});},60000));
      }else if(op.kind==='command'){
        x='r'+(++seq);
        reply(rid,await wait(x,function(){host.runCommand('SVL_INVOKE',{reqId:x,verb:'runCommand',args:{name:op.name,args:op.args||[]}});},60000));
      }else if(op.kind==='svg'){
        reply(rid,await wait('export',function(){host.exportSVG();},20000));
      }else if(op.kind==='panelReply'){
        console.log('[rayzia-remote-mcp] reply_to_user:',op.text);
        reply(rid,{ok:true,note:'remote bridge reply logged to the Rayzia console'});
      }else if(op.kind==='render'){
        var wk=w2&&w2.worker;
        if(!wk){reply(rid,{error:'no worker for render'});return;}
        try{host.runCommand('Zoom.fitPage');}catch(e){}
        await settle(200);
        var shot=await wait('bugshot',function(){wk.postMessage({type:'bugshot-request'});},10000);
        if(shot.error||!shot.px){reply(rid,{error:'bugshot failed: '+(shot.error||'no pixels')});return;}
        reply(rid,encodePng(shot.px,shot.w,shot.h,op.maxEdge||1024));
      }else if(op.kind==='draw'){
        x='r'+(++seq);
        var tp=await wait('tape:'+x,function(){host.runCommand('SVL_COMPILE_DRAW',{reqId:x,verb:op.verb,args:op.args||{}});},30000);
        if(tp&&tp.tape){
          var done=await wait('replay',function(){host.replayTape(tp.tape);},30000);
          reply(rid,{ok:!!(done&&done.ok)});
        }else reply(rid,{error:'compile failed'});
      }else{
        reply(rid,{error:'unknown op '+op.kind});
      }
    }catch(e){reply(rid,{error:String(e&&e.message||e)});}
  }

  async function pollLoop(){
    while(!stopped){
      try{
        var r=await fetch(SERVER+'/poll?ts='+Date.now(),{cache:'no-store'});
        if(r.status===200){
          var op=await r.json();
          if(op&&op.reqId){ await handle(op); }
        }else if(r.status!==204){
          await settle(1500);
        }
      }catch(e){
        await settle(1500);
      }
    }
  }

  stopped=false;
  window.__rayziaRemoteBridge={
    stop:function(){stopped=true;window.__rayziaRemoteBridge=null;},
    server:SERVER
  };
  console.log('[rayzia-remote-mcp] polling '+SERVER+' — driving window.__skiavgW2.host');
  pollLoop();
})();
