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
    '34-entree-1': "Bienvenue à Mundiapolis ! Vous êtes à l'entrée principale du campus. Une université internationale au cœur de Casablanca.",
    '36-entree-2': "Voici l'entrée extérieure du campus, entourée de palmiers et d'une architecture distincte.",
    '32-biblio-1': "La bibliothèque universitaire — plus de 50 000 ouvrages, des espaces de travail modernes et une vue sur le campus.",
    '33-biblio-2': "La salle de lecture de la bibliothèque — calme, lumineuse, idéale pour les révisions.",
    '0-labo-electronique': "Le laboratoire d'électronique, équipé d'oscilloscopes et de stations de mesure pour les travaux pratiques.",
    '3-labo-optique': "Le laboratoire d'optique — expériences sur la lumière, les fibres optiques et les phénomènes ondulatoires.",
    '4-labo-electicite': "Le laboratoire d'électricité, dédié aux circuits et aux systèmes électriques.",
    '7-labo-chimique': "Le laboratoire de chimie — sécurisé et équipé pour les expériences de chimie générale et organique.",
    '39-salle-de-conference': "L'amphithéâtre de Mundiapolis — il accueille conférences, soutenances et événements académiques majeurs.",
    '38-buvette-1': "La cafétéria du campus — un espace convivial pour se retrouver entre cours.",
    '40-buvette-2': "L'espace restauration extérieur — parfait pour déjeuner en plein air.",
    '37-mosquee': "La mosquée du campus, ouverte à toute la communauté universitaire.",
    '41-salle-de-sport-': "Le complexe sportif de Mundiapolis — terrains, salles et équipements pour une vie sportive active.",
    '46-salle-de-sport-piscine': "La piscine universitaire — un équipement rare dans les campus marocains.",
    '43-salle-de-sport-musculation': "La salle de musculation, disponible pour tous les étudiants.",
    '30-terrain-de-foot': "Le terrain de football, au cœur du campus et des activités sportives étudiantes.",
    '12-administration': "Le bâtiment administratif — inscriptions, scolarité et services aux étudiants.",
    '24-cite-universitaire-4': "La cité universitaire — résidences modernes pour les étudiants qui choisissent de vivre sur le campus.",
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
    fullscreenToggleElement.addEventListener('click', function() {
      if(window.parent && window.parent !== window){
        window.parent.postMessage({type:'requestFullscreen'}, '*');
      } else {
        document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      }
    });
    screenfull.on('change', function() {
      if (screenfull.isFullscreen) {
        fullscreenToggleElement.classList.add('enabled');
      } else {
        fullscreenToggleElement.classList.remove('enabled');
      }
    });
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

  // Listen for scene switch messages from parent page
  window.addEventListener('message', function(e){
    if(e.data && e.data.type === 'switchScene' && e.data.sceneId){
      var target = findSceneById(e.data.sceneId);
      if(target){
        switchScene(target);
      }
    }
  });

})();
