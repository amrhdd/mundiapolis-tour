/*
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

(function() {
  var Marzipano = window.Marzipano;
  var bowser = window.bowser;
  var screenfull = window.screenfull;
  var data = window.APP_DATA;

  var amiraVoiceEnabled = true;

  var AMIRA_LINES = {
    '34-entree-1': "Bienvenue au campus de Nouaceur — l'École d'Ingénierie de Mundiapolis. C'est par ici que passent chaque matin les futurs ingénieurs en informatique, industriel et aéronautique. Le campus est à vous.",
    '36-entree-2': "L'entrée du campus. On est à Nouaceur, aux portes de l'aéroport de Casablanca — pas un hasard quand on forme des ingénieurs en systèmes aéronautiques.",
    '32-biblio-1': "La bibliothèque. C'est ici que la moitié des ingénieurs de Mundiapolis ont survécu à leurs partiels — et où les meilleures idées de projets naissent à voix basse.",
    '33-biblio-2': "La salle de lecture. Si vous cherchez une place près de la fenêtre en période d'examens, levez-vous tôt — tout le monde a la même idée.",
    '0-labo-electronique': "Le labo d'électronique. Oscilloscopes, circuits, et beaucoup d'essais-erreurs. C'est normal de rater le premier TP — on apprend en faisant, c'est tout l'esprit de l'école.",
    '3-labo-optique': "Le labo d'optique. La lumière, les fibres, les ondes — la théorie des amphis devient tangible sur ces paillasses.",
    '4-labo-electicite': "Le labo d'électricité. Les circuits qu'on dessine en cours, on les construit vraiment ici.",
    '7-labo-chimique': "Le labo de chimie. Sérieux, sécurisé — et le seul endroit du campus où la blouse devient un réflexe.",
    '39-salle-de-conference': "L'amphithéâtre. Conférences, soutenances de projets de fin d'études, et la finale du championnat Inter-Class. La grande salle des grands moments.",
    '38-buvette-1': "La cafétéria. Le vrai cœur social du campus — c'est ici que se forment les binômes de projet et que les pauses s'éternisent un peu trop.",
    '40-buvette-2': "L'espace en plein air. Aux beaux jours casablancais — c'est-à-dire presque toute l'année — c'est la meilleure place pour déjeuner.",
    '37-mosquee': "La mosquée du campus, ouverte à toute la communauté. Un coin de calme entre deux TP.",
    '41-salle-de-sport-': "Le complexe sportif. Entre deux cours d'ingénierie, c'est ici qu'on décompresse — et que se jouent les rivalités du championnat Inter-Class.",
    '46-salle-de-sport-piscine': "La piscine. Oui, une vraie piscine sur un campus d'ingénieurs à Nouaceur — c'est rare, profitez-en.",
    '43-salle-de-sport-musculation': "La salle de musculation, ouverte à tous les étudiants — parce qu'on révise mieux après avoir bougé.",
    '30-terrain-de-foot': "Le terrain et les espaces verts. Le poumon du campus — matchs improvisés, révisions sur l'herbe, et un peu d'air entre deux amphis.",
    '12-administration': "L'administration et l'infirmerie. Inscriptions, scolarité, et le genre d'endroit qu'on espère ne pas trop fréquenter — mais qui dépanne.",
    '26-cite-universitaire-l-internat': "La cité universitaire. Pour celles et ceux qui font de Nouaceur leur maison le temps des études. C'est ici que se termine la visite — mais que commence votre histoire d'ingénieur.",
  };

  // Grab elements from DOM.
  var panoElement = document.querySelector('#pano');
  var sceneNameElement = document.querySelector('#titleBar .sceneName');
  var sceneListElement = document.querySelector('#sceneList');
  var sceneElements = document.querySelectorAll('#sceneList .scene');
  var sceneListToggleElement = document.querySelector('#sceneListToggle');
  var autorotateToggleElement = document.querySelector('#autorotateToggle');
  var fullscreenToggleElement = document.querySelector('#fullscreenToggle');

  // Detect desktop or mobile mode.
  if (window.matchMedia) {
    var setMode = function() {
      if (mql.matches) {
        document.body.classList.remove('desktop');
        document.body.classList.add('mobile');
      } else {
        document.body.classList.remove('mobile');
        document.body.classList.add('desktop');
      }
    };
    var mql = matchMedia("(max-width: 500px), (max-height: 500px)");
    setMode();
    mql.addListener(setMode);
  } else {
    document.body.classList.add('desktop');
  }

  // Detect whether we are on a touch device.
  document.body.classList.add('no-touch');
  window.addEventListener('touchstart', function() {
    document.body.classList.remove('no-touch');
    document.body.classList.add('touch');
  });

  // Use tooltip fallback mode on IE < 11.
  if (bowser.msie && parseFloat(bowser.version) < 11) {
    document.body.classList.add('tooltip-fallback');
  }

  // Viewer options.
  var viewerOpts = {
    controls: {
      mouseViewMode: data.settings.mouseViewMode
    }
  };

  // Initialize viewer.
  var viewer = new Marzipano.Viewer(panoElement, viewerOpts);

  // Create scenes.
  var scenes = data.scenes.map(function(data) {
    var urlPrefix = "tiles";
    var source = Marzipano.ImageUrlSource.fromString(
      urlPrefix + "/" + data.id + "/{z}/{f}/{y}/{x}.jpg",
      { cubeMapPreviewUrl: urlPrefix + "/" + data.id + "/preview.jpg" });
    var geometry = new Marzipano.CubeGeometry(data.levels);

    var limiter = Marzipano.RectilinearView.limit.traditional(data.faceSize, 100*Math.PI/180, 120*Math.PI/180);
    var view = new Marzipano.RectilinearView(data.initialViewParameters, limiter);

    var scene = viewer.createScene({
      source: source,
      geometry: geometry,
      view: view,
      pinFirstLevel: true
    });

    // Create link hotspots.
    data.linkHotspots.forEach(function(hotspot) {
      var element = createLinkHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch });
    });

    // Create info hotspots.
    data.infoHotspots.forEach(function(hotspot) {
      var element = createInfoHotspotElement(hotspot);
      scene.hotspotContainer().createHotspot(element, { yaw: hotspot.yaw, pitch: hotspot.pitch });
    });

    return {
      data: data,
      scene: scene,
      view: view
    };
  });

  // Set up autorotate, if enabled.
  var autorotate = Marzipano.autorotate({
    yawSpeed: 0.03,
    targetPitch: 0,
    targetFov: Math.PI/2
  });
  if (data.settings.autorotateEnabled && autorotateToggleElement) {
    autorotateToggleElement.classList.add('enabled');
  }

  // Set handler for autorotate toggle.
  if(autorotateToggleElement) autorotateToggleElement.addEventListener('click', toggleAutorotate);

  // Set up fullscreen mode, if supported.
  if (screenfull.enabled && data.settings.fullscreenButton) {
    document.body.classList.add('fullscreen-enabled');
  } else {
    document.body.classList.add('fullscreen-disabled');
  }

  // Set handler for scene list toggle.
  if(sceneListToggleElement) sceneListToggleElement.addEventListener('click', toggleSceneList);

  // Start with the scene list open on desktop.
  if (!document.body.classList.contains('mobile')) {
    showSceneList();
  }

  // Set handler for scene switch.
  scenes.forEach(function(scene) {
    var el = document.querySelector('#sceneList .scene[data-id="' + scene.data.id + '"]');
    if(!el) return;
    el.addEventListener('click', function() {
      switchScene(scene);
      // On mobile, hide scene list after selecting a scene.
      if (document.body.classList.contains('mobile')) {
        hideSceneList();
      }
    });
  });

  // DOM elements for view controls.
  var viewUpElement = document.querySelector('#viewUp');
  var viewDownElement = document.querySelector('#viewDown');
  var viewLeftElement = document.querySelector('#viewLeft');
  var viewRightElement = document.querySelector('#viewRight');
  var viewInElement = document.querySelector('#viewIn');
  var viewOutElement = document.querySelector('#viewOut');

  // Dynamic parameters for controls.
  var velocity = 0.7;
  var friction = 3;

  // Associate view controls with elements.
  var controls = viewer.controls();
  controls.registerMethod('upElement',    new Marzipano.ElementPressControlMethod(viewUpElement,     'y', -velocity, friction), true);
  controls.registerMethod('downElement',  new Marzipano.ElementPressControlMethod(viewDownElement,   'y',  velocity, friction), true);
  controls.registerMethod('leftElement',  new Marzipano.ElementPressControlMethod(viewLeftElement,   'x', -velocity, friction), true);
  controls.registerMethod('rightElement', new Marzipano.ElementPressControlMethod(viewRightElement,  'x',  velocity, friction), true);
  controls.registerMethod('inElement',    new Marzipano.ElementPressControlMethod(viewInElement,  'zoom', -velocity, friction), true);
  controls.registerMethod('outElement',   new Marzipano.ElementPressControlMethod(viewOutElement, 'zoom',  velocity, friction), true);

  function showAmiraCard(text, sceneName){
    var card = document.getElementById('amira-card');
    var textEl = document.getElementById('amira-card-text');
    var sceneEl = document.getElementById('amira-card-scene');
    if(!card || !textEl) return;
    textEl.textContent = text;
    if(sceneEl) sceneEl.textContent = sceneName || '';
    card.style.bottom = '0px';
    clearTimeout(window._amiraCardTimer);
    window._amiraCardTimer = setTimeout(function(){
      card.style.bottom = '-160px';
    }, 8000);
  }

  document.addEventListener('DOMContentLoaded', function(){
    var closeBtn = document.getElementById('amira-card-close');
    if(closeBtn){
      closeBtn.addEventListener('click', function(){
        var card = document.getElementById('amira-card');
        if(card) card.style.bottom = '-160px';
        clearTimeout(window._amiraCardTimer);
      });
    }

    var voiceToggle = document.getElementById('amira-voice-toggle');
    if(voiceToggle){
      voiceToggle.addEventListener('click', function(){
        amiraVoiceEnabled = !amiraVoiceEnabled;
        this.textContent = amiraVoiceEnabled ? '🔊' : '🔇';
        this.style.borderColor = amiraVoiceEnabled
          ? 'rgba(244,237,226,0.25)'
          : 'rgba(194,90,50,0.5)';
        this.style.color = amiraVoiceEnabled
          ? 'rgba(244,237,226,0.8)'
          : 'rgba(194,90,50,0.8)';
      });
    }
  });

  function sanitize(s) {
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;');
  }

  function switchScene(scene) {
    stopAutorotate();
    scene.view.setParameters(scene.data.initialViewParameters);
    scene.scene.switchTo();
    startAutorotate();
    updateSceneName(scene);
    updateSceneList(scene);

    // Update custom scene name display and counter
    var nameEl = document.getElementById('scene-name-display');
    var counterEl = document.getElementById('scene-counter');
    if(nameEl && scene && scene.data && scene.data.name){
      nameEl.textContent = scene.data.name;
    }
    if(counterEl){
      var idx = data.scenes.indexOf(scene.data) + 1;
      counterEl.textContent = idx + ' / ' + data.scenes.length;
    }

    // Amira slide-up card + audio
    (function(currentScene){
      var line = AMIRA_LINES[currentScene.data.id];
      if(line){
        showAmiraCard(line, currentScene.data.name);
        if(amiraVoiceEnabled && window.parent && window.parent !== window){
          window.parent.postMessage({type:'amiraSpeak', text:line, lang:'fr'}, '*');
        }
      }
    })(scene);
  }

  function updateSceneName(scene) {
    if(sceneNameElement) sceneNameElement.innerHTML = sanitize(scene.data.name);
  }

  function updateSceneList(scene) {
    for (var i = 0; i < sceneElements.length; i++) {
      var el = sceneElements[i];
      if(!el) continue;
      if (el.getAttribute('data-id') === scene.data.id) {
        el.classList.add('current');
      } else {
        el.classList.remove('current');
      }
    }
  }

  function showSceneList() {
    if(sceneListElement) sceneListElement.classList.add('enabled');
    if(sceneListToggleElement) sceneListToggleElement.classList.add('enabled');
  }

  function hideSceneList() {
    if(sceneListElement) sceneListElement.classList.remove('enabled');
    if(sceneListToggleElement) sceneListToggleElement.classList.remove('enabled');
  }

  function toggleSceneList() {
    if(sceneListElement) sceneListElement.classList.toggle('enabled');
    if(sceneListToggleElement) sceneListToggleElement.classList.toggle('enabled');
  }

  function startAutorotate() {
    if (!autorotateToggleElement.classList.contains('enabled')) {
      return;
    }
    viewer.startMovement(autorotate);
    viewer.setIdleMovement(3000, autorotate);
  }

  function stopAutorotate() {
    viewer.stopMovement();
    viewer.setIdleMovement(Infinity);
  }

  function toggleAutorotate() {
    if (autorotateToggleElement.classList.contains('enabled')) {
      autorotateToggleElement.classList.remove('enabled');
      stopAutorotate();
    } else {
      autorotateToggleElement.classList.add('enabled');
      startAutorotate();
    }
  }

  function createLinkHotspotElement(hotspot) {

    // The wrapper IS the circle button.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('link-hotspot');

    // Bold chevron SVG, rotated to face the destination.
    var svg = document.createElement('div');
    svg.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>';
    var svgEl = svg.firstChild;
    svgEl.style.transform = 'rotate(' + hotspot.rotation + 'rad)';

    // Add click event handler.
    wrapper.addEventListener('click', function() {
      switchScene(findSceneById(hotspot.target));
    });

    // Prevent touch and scroll events from interfering with the hotspot.
    stopTouchAndScrollEventPropagation(wrapper);

    // Tooltip below the circle.
    var tooltip = document.createElement('div');
    tooltip.classList.add('hotspot-tooltip');
    tooltip.classList.add('link-hotspot-tooltip');
    tooltip.innerHTML = findSceneDataById(hotspot.target).name;

    wrapper.appendChild(svgEl);
    wrapper.appendChild(tooltip);

    return wrapper;
  }

  function createInfoHotspotElement(hotspot) {

    // Create wrapper element to hold icon and tooltip.
    var wrapper = document.createElement('div');
    wrapper.classList.add('hotspot');
    wrapper.classList.add('info-hotspot');

    // Create hotspot/tooltip header.
    var header = document.createElement('div');
    header.classList.add('info-hotspot-header');

    // Create image element.
    var iconWrapper = document.createElement('div');
    iconWrapper.classList.add('info-hotspot-icon-wrapper');
    var icon = document.createElement('img');
    icon.src = 'img/info.png';
    icon.classList.add('info-hotspot-icon');
    iconWrapper.appendChild(icon);

    // Create title element.
    var titleWrapper = document.createElement('div');
    titleWrapper.classList.add('info-hotspot-title-wrapper');
    var title = document.createElement('div');
    title.classList.add('info-hotspot-title');
    title.innerHTML = hotspot.title;
    titleWrapper.appendChild(title);

    // Create close element.
    var closeWrapper = document.createElement('div');
    closeWrapper.classList.add('info-hotspot-close-wrapper');
    var closeIcon = document.createElement('img');
    closeIcon.src = 'img/close.png';
    closeIcon.classList.add('info-hotspot-close-icon');
    closeWrapper.appendChild(closeIcon);

    // Construct header element.
    header.appendChild(iconWrapper);
    header.appendChild(titleWrapper);
    header.appendChild(closeWrapper);

    // Create text element.
    var text = document.createElement('div');
    text.classList.add('info-hotspot-text');
    text.innerHTML = hotspot.text;

    // Place header and text into wrapper element.
    wrapper.appendChild(header);
    wrapper.appendChild(text);

    // Create a modal for the hotspot content to appear on mobile mode.
    var modal = document.createElement('div');
    modal.innerHTML = wrapper.innerHTML;
    modal.classList.add('info-hotspot-modal');
    document.body.appendChild(modal);

    var toggle = function() {
      wrapper.classList.toggle('visible');
      modal.classList.toggle('visible');
    };

    // Show content when hotspot is clicked.
    wrapper.querySelector('.info-hotspot-header').addEventListener('click', toggle);

    // Hide content when close icon is clicked.
    modal.querySelector('.info-hotspot-close-wrapper').addEventListener('click', toggle);

    // Prevent touch and scroll events from reaching the parent element.
    // This prevents the view control logic from interfering with the hotspot.
    stopTouchAndScrollEventPropagation(wrapper);

    return wrapper;
  }

  // Prevent touch and scroll events from reaching the parent element.
  function stopTouchAndScrollEventPropagation(element, eventList) {
    var eventList = [ 'touchstart', 'touchmove', 'touchend', 'touchcancel',
                      'wheel', 'mousewheel' ];
    for (var i = 0; i < eventList.length; i++) {
      element.addEventListener(eventList[i], function(event) {
        event.stopPropagation();
      });
    }
  }

  function findSceneById(id) {
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i].data.id === id) {
        return scenes[i];
      }
    }
    return null;
  }

  function findSceneDataById(id) {
    for (var i = 0; i < data.scenes.length; i++) {
      if (data.scenes[i].id === id) {
        return data.scenes[i];
      }
    }
    return null;
  }

  // Display the initial scene — read from URL hash or default to main entrance.
  function getSceneFromHash(){
    var m = window.location.hash.match(/scene=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  var hashScene = getSceneFromHash();
  var startScene = null;
  if(hashScene){
    startScene = scenes.find(function(s){ return s.data.id === hashScene; });
  }
  if(!startScene){
    startScene = scenes.find(function(s){ return s.data.id === '34-entree-1'; }) || scenes[0];
  }
  switchScene(startScene);

  // ── Listen for scene switch requests from the parent page ──
  window.addEventListener('message', function(e){
    if(!e.data || e.data.type !== 'switchScene' || !e.data.sceneId) return;

    var targetId = e.data.sceneId;
    var target = null;
    for(var i = 0; i < scenes.length; i++){
      if(scenes[i].data && scenes[i].data.id === targetId){
        target = scenes[i];
        break;
      }
    }

    if(target){
      if(typeof switchScene === 'function'){
        switchScene(target);
      } else if(target.scene && typeof target.scene.switchTo === 'function'){
        target.scene.switchTo();
      }
    } else {
      console.warn('switchScene: no scene found with id', targetId);
    }
  });

})();

// ── Fullscreen toggle (posts to parent since we're in an iframe) ──
(function(){
  var btn = document.getElementById('fullscreenToggle');
  if(!btn){
    btn = document.querySelector('.fullscreen-toggle') ||
          document.querySelector('[id*="fullscreen"]') ||
          document.querySelector('[class*="fullscreen"]');
  }
  if(!btn) return;

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    if(window.parent && window.parent !== window){
      window.parent.postMessage({type:'toggleFullscreen'}, '*');
    } else {
      if(!document.fullscreenElement){
        (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    }
  });

  window.addEventListener('message', function(e){
    if(e.data && e.data.type === 'fullscreenState'){
      if(e.data.active){
        btn.classList.add('enabled');
      } else {
        btn.classList.remove('enabled');
      }
    }
  });
})();
