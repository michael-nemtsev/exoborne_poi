// Configuration
const API_ENDPOINT = '/api'; // Replace with your actual API endpoint
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1430;
const STORAGE_KEY = 'game_map_pois';
const DEFAULT_ZOOM = 0.5;

// State management
let pois = [];

let currentZoom = DEFAULT_ZOOM;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let mapPosition = { x: 0, y: 0 };
let addMode = false;
let tempPoi = null;
let selectedPoi = null;
let lastSyncTime = 0;

// Update the context menu HTML structure
function updateContextMenuHtml() {
  $('#context-menu').html(`
    <div class="context-menu-form">
      <div class="context-menu-field">
        <label for="context-poi-type">Type:</label>
        <select id="context-poi-type">
          <option value="shelter">Rebirth Shelter</option>
          <option value="fragment">Clearance Fragment</option>
          <option value="dungeon">Dungeon</option>
          <option value="resource">Resource</option>
          <option value="landmark">Landmark</option>
          <option value="npc">NPC</option>
          <option value="secret">Secret</option>
          <option value="boss">Boss</option>
        </select>
      </div>
      <div class="context-menu-field">
        <label for="context-poi-note">Note:</label>
        <textarea id="context-poi-note" placeholder="Add a note about this POI (shown on hover)"></textarea>
      </div>
      <div class="context-menu-buttons">
        <button id="context-save-btn">Save</button>
        <button id="context-delete-btn" style="background-color: #f44336;">Delete</button>
        <button id="context-cancel-btn">Cancel</button>
      </div>
    </div>
  `);

  // Set up event handlers
  $('#context-save-btn').off('click').on('click', saveEditedPoi);
  $('#context-cancel-btn').off('click').on('click', function () {
    $('#context-menu').hide();
  });

  $('#context-delete-btn').off('click').on('click', function () {
    const poiId = $('#context-menu').data('poi-id');
    if (poiId) {
      deletePoi(poiId);
      $('#context-menu').hide();
    }
  });

  // Set the color of the dropdown
  $('#context-poi-type').on('change', function () {
    const selectedType = $(this).val();
    $(this).css('color', getPoiColor(selectedType));
  });
}

// Initialize the map
function initMap() {
  const mapElement = $('#game-map');
  mapElement.css({
    width: MAP_WIDTH + 'px',
    height: MAP_HEIGHT + 'px',
    transform: `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`
  });

  // Center the map initially
  resetMapView();

  // Mouse events for dragging
  mapElement.on('mousedown', startDragging);
  $(document).on('mousemove', dragMap);
  $(document).on('mouseup', stopDragging);

  // Map controls
  $('#zoom-in').on('click', () => changeZoom(0.1));
  $('#zoom-out').on('click', () => changeZoom(-0.1));
  $('#reset-view').on('click', resetMapView);

  // POI controls
  $('#add-mode-btn').on('click', toggleAddMode);
  $('#refresh-btn').on('click', syncWithServer);
  $('#save-poi-btn').on('click', savePoi);
  $('#cancel-poi-btn').on('click', cancelAddPoi);

  // Initialize the context menu
  updateContextMenuHtml();

  // Load POIs
  //loadPoisFromStorage();
  loadPoisFromFile();
  syncWithServer();
}

function loadPoisFromFile() {
  // Show a notification that we're loading
  showNotification('Loading POIs from file...');
  
  // Use AJAX to fetch the file (assuming it's a JSON file)
  $.ajax({
      url: 'pois.json', // Path to your JSON file containing POIs
      method: 'GET',
      dataType: 'json',
      success: function(data) {
          // Update the pois array with the loaded data
          pois = data;
          
          // Render the POIs on the map
          renderPois();
          
          // Save to local storage as a backup
          savePoisToStorage();
          
          showNotification('POIs loaded successfully');
      },
      error: function(xhr, status, error) {
          console.error('Error loading POIs from file:', error);
          showNotification('Error loading POIs. Using local data.', true);
          
          // Fall back to local storage if available
          loadPoisFromStorage();
      }
  });
}

// Map interaction functions
function startDragging(e) {
  if (addMode) {
    // In add mode, clicking creates a POI instead of dragging
    const mapOffset = $('#game-map').offset();
    const clickX = (e.pageX - mapOffset.left) / currentZoom;
    const clickY = (e.pageY - mapOffset.top) / currentZoom;

    tempPoi = {
      id: 'temp-' + Date.now(),
      name: `POI-${Date.now().toString().slice(-4)}`,
      type: 'shelter',
      description: '',
      x: clickX,
      y: clickY,
      visible: true
    };

    // Show the form
    $('#poi-type').val('shelter');
    $('#poi-desc').val('');
    $('#poi-form').show();
    return;
  }

  isDragging = true;
  dragStart = {
    x: e.pageX - mapPosition.x * currentZoom,
    y: e.pageY - mapPosition.y * currentZoom
  };
  $('#game-map').css('cursor', 'grabbing');
}

function dragMap(e) {
  if (!isDragging) return;

  // Get the new mouse position
  const mouseX = e.pageX;
  const mouseY = e.pageY;

  // Calculate new position based on the drag start point
  let newX = (mouseX - dragStart.x) / currentZoom;
  let newY = (mouseY - dragStart.y) / currentZoom;

  // Get container dimensions
  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();

  // Calculate boundaries
  const maxX = 0;
  const minX = containerWidth / currentZoom - MAP_WIDTH;
  const maxY = 0;
  const minY = containerHeight / currentZoom - MAP_HEIGHT;

  if (MAP_WIDTH * currentZoom > containerWidth) {
    newX = Math.max(minX, Math.min(maxX, newX));
  } else {
    newX = (containerWidth / currentZoom - MAP_WIDTH) / 2;
  }

  if (MAP_HEIGHT * currentZoom > containerHeight) {
    newY = Math.max(minY, Math.min(maxY, newY));
  } else {
    newY = (containerHeight / currentZoom - MAP_HEIGHT) / 2;
  }

  mapPosition = { x: newX, y: newY };
  updateMapTransform();
}

function stopDragging() {
  isDragging = false;
  $('#game-map').css('cursor', 'move');
}

function changeZoom(delta) {
  const oldZoom = currentZoom;
  currentZoom = Math.max(0.2, Math.min(2, currentZoom + delta));

  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();

  const centerX = containerWidth / 2;
  const centerY = containerHeight / 2;

  const centerMapX = centerX / oldZoom - mapPosition.x;
  const centerMapY = centerY / oldZoom - mapPosition.y;

  mapPosition.x = -centerMapX + centerX / currentZoom;
  mapPosition.y = -centerMapY + centerY / currentZoom;

  if (MAP_WIDTH * currentZoom < containerWidth) {
    mapPosition.x = (containerWidth / currentZoom - MAP_WIDTH) / 2;
  } else {
    const minX = containerWidth / currentZoom - MAP_WIDTH;
    const maxX = 0;
    mapPosition.x = Math.max(minX, Math.min(maxX, mapPosition.x));
  }

  if (MAP_HEIGHT * currentZoom < containerHeight) {
    mapPosition.y = (containerHeight / currentZoom - MAP_HEIGHT) / 2;
  } else {
    const minY = containerHeight / currentZoom - MAP_HEIGHT;
    const maxY = 0;
    mapPosition.y = Math.max(minY, Math.min(maxY, mapPosition.y));
  }

  updateMapTransform();
}

function updateMapTransform() {
  $('#game-map').css('transform', `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`);
}

function resetMapView() {
  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();

  currentZoom = DEFAULT_ZOOM;

  mapPosition.x = (containerWidth / currentZoom - MAP_WIDTH) / 2;
  mapPosition.y = (containerHeight / currentZoom - MAP_HEIGHT) / 2;

  updateMapTransform();
}

// POI management functions
function toggleAddMode() {
  addMode = !addMode;
  $('#add-mode-btn').toggleClass('active', addMode);

  if (addMode) {
    $('#game-map').css('cursor', 'crosshair');
    showNotification('Click on the map to add a POI');
  } else {
    $('#game-map').css('cursor', 'move');
    $('#poi-form').hide();
    tempPoi = null;
  }
}

function savePoi() {
  if (!tempPoi) return;

  const poiType = $('#poi-type').val().trim();
  const poi = {
    id: 'poi-' + Date.now(),
    name: tempPoi.name,
    type: poiType,
    description: $('#poi-desc').val().trim(),
    x: tempPoi.x,
    y: tempPoi.y,
    visible: true
  };

  pois.push(poi);
  renderPois();
  savePoisToStorage();

  $('#poi-form').hide();
  tempPoi = null;
  addMode = false;
  $('#add-mode-btn').removeClass('active');
  $('#game-map').css('cursor', 'move');

  showNotification('POI added successfully');
  syncWithServer(true);
}

function cancelAddPoi() {
  $('#poi-form').hide();
  tempPoi = null;
}

function togglePoiVisibility(id) {
  const poi = pois.find(p => p.id === id);
  if (poi) {
    poi.visible = !poi.visible;
    renderPois();
    savePoisToStorage();
  }
}

function selectPoi(id) {
  selectedPoi = id;
  renderPois();

  const poi = pois.find(p => p.id === id);
  if (poi) {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    const poiScreenX = poi.x * currentZoom + mapPosition.x * currentZoom;
    const poiScreenY = poi.y * currentZoom + mapPosition.y * currentZoom;

    const margin = 100;
    const isOutsideX = poiScreenX < margin || poiScreenX > containerWidth - margin;
    const isOutsideY = poiScreenY < margin || poiScreenY > containerHeight - margin;

    if (isOutsideX || isOutsideY) {
      mapPosition = {
        x: containerWidth / (2 * currentZoom) - poi.x,
        y: containerHeight / (2 * currentZoom) - poi.y
      };
      updateMapTransform();
    }
  }
}

function deletePoi(poiId) {
  if (confirm('Are you sure you want to delete this POI?')) {
    pois = pois.filter(p => p.id !== poiId);
    renderPois();
    savePoisToStorage();
    showNotification('POI deleted successfully');
  }
}

// Context menu functions and saving/editing POIs
function showContextMenu(screenX, screenY, mapX, mapY) {
  const contextMenu = $('#context-menu');
  updateContextMenuHtml();

  $('#context-poi-type').val('shelter');
  $('#context-poi-note').val('');
  $('#context-delete-btn').hide();

  $('#context-poi-type').css('color', getPoiColor($('#context-poi-type').val()));
  contextMenu.data('map-x', mapX);
  contextMenu.data('map-y', mapY);

  contextMenu.css({
    top: screenY,
    left: screenX
  }).show();

  $('#context-save-btn').off('click').on('click', saveContextMenuPoi);
  $('#context-cancel-btn').off('click').on('click', function () {
    contextMenu.hide();
  });

  contextMenu.off('click').on('click', function (e) {
    e.stopPropagation();
  });
}

function showEditContextMenu(poiId, screenX, screenY) {
  const poi = pois.find(p => p.id === poiId);
  if (!poi) return;

  const contextMenu = $('#context-menu');
  updateContextMenuHtml();

  $('#context-poi-type').val(poi.type);
  $('#context-poi-note').val(poi.description);
  contextMenu.data('poi-id', poiId);

  contextMenu.css({
    top: screenY + 'px',
    left: screenX + 'px',
    display: 'block'
  });

  $('#context-delete-btn').show();
}

function saveContextMenuPoi() {
  const contextMenu = $('#context-menu');
  const mapX = contextMenu.data('map-x');
  const mapY = contextMenu.data('map-y');

  const name = `POI-${Date.now().toString().slice(-4)}`;
  const typeSelect = document.getElementById('context-poi-type');
  const type = typeSelect ? typeSelect.value : 'shelter';
  const description = $('#context-poi-note').val().trim();

  const poi = {
    id: 'poi-' + Date.now(),
    name: name,
    type: type,
    description: description,
    x: mapX,
    y: mapY,
    visible: true
  };

  pois.push(poi);
  renderPois();
  savePoisToStorage();
  contextMenu.hide();
  showNotification('POI added successfully');
  selectPoi(poi.id);
  syncWithServer(true);
}

function saveEditedPoi() {
  const contextMenu = $('#context-menu');
  const poiId = contextMenu.data('poi-id');

  const poi = pois.find(p => p.id === poiId);
  if (!poi) return;

  poi.type = $('#context-poi-type').val();
  poi.description = $('#context-poi-note').val().trim();

  renderPois();
  savePoisToStorage();
  contextMenu.hide();
  showNotification('POI updated successfully');
  selectPoi(poiId);
  syncWithServer(true);
}

// Rendering functions
function renderPois() {
  $('.poi-marker').remove();
  $('.poi-tooltip').remove();

  const tooltip = $(`<div class="poi-tooltip"></div>`);
  $('body').append(tooltip);

  pois.filter(p => p.visible).forEach(poi => {
    const poiColor = getPoiColor(poi.type);
    const marker = $(`
      <div class="poi-marker" data-id="${poi.id}" style="left: ${poi.x}px; top: ${poi.y}px;">
        <svg viewBox="0 0 24 24">
          <path fill="${poiColor}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
    `);

    marker.on('mouseenter', function () {
      tooltip.text(poi.description);
      tooltip.css({
        visibility: 'visible',
        opacity: 1
      });
    });``

    marker.on('mouseleave', function () {
      tooltip.css({
        visibility: 'hidden',
        opacity: 0
      });
    });

    $('#game-map').append(marker);
  });
}

function getPoiColor(type) {
  const normalizedType = String(type).toLowerCase().trim();
  switch (normalizedType) {
    case 'shelter': return '#ffc107';
    case 'fragment': return '#4caf50';
    case 'dungeon': return '#f44336';
    case 'resource': return '#2196f3';
    case 'landmark': return '#9c27b0';
    case 'npc': return '#ff9800';
    case 'secret': return '#607d8b';
    case 'boss': return '#e91e63';
    default:
      console.log('Unknown POI type:', type);
      return '#ffffff';
  }
}

// Storage and sync functions
function loadPoisFromStorage() {
  const storedData = localStorage.getItem(STORAGE_KEY);
  if (storedData) {
      try {
          const data = JSON.parse(storedData);
          pois = data.pois || []; // Use empty array if none in storage
          lastSyncTime = data.lastSyncTime || 0;
          renderPois();
      } catch (e) {
          console.error('Error loading POIs from storage:', e);
          // If error loading, show default empty POIs
          pois = [];
          renderPois();
      }
  } else {
      // If no storage data exists, initialize with empty array
      pois = [];
      savePoisToStorage();
      renderPois();
  }
}

function savePoisToStorage() {
  const dataToStore = {
    pois: pois,
    lastSyncTime: Date.now()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToStore));
}

function syncWithServer(force = false) {
  if (force || Date.now() - lastSyncTime > 60000) {
    showNotification('Syncing with server...');

    setTimeout(() => {
      lastSyncTime = Date.now();
      savePoisToStorage();
      showNotification('Sync complete');
    }, 1000);
  }
}

function showNotification(message, isError = false) {
  const notification = $('#notification');
  notification.text(message);
  notification.css('background-color', isError ? 'rgba(255, 0, 0, 0.8)' : 'rgba(0, 0, 0, 0.8)');
  notification.fadeIn(300).delay(2000).fadeOut(300);
}

function toggleGroupVisibility(type, visible) {
  pois.forEach(poi => {
    if (poi.type === type) {
      poi.visible = visible;
    }
  });
  renderPois();
  savePoisToStorage();
}

$(document).ready(function () {
  initMap();

  // $('#game-map').on('contextmenu', function (e) {
  $('#game-map').on('dblclick', function (e) {
    e.preventDefault();
    const mapOffset = $('#game-map').offset();
    const clickX = (e.pageX - mapOffset.left) / currentZoom;
    const clickY = (e.pageY - mapOffset.top) / currentZoom;
    const clickedPoi = $(e.target).closest('.poi-marker');

    if (clickedPoi.length) {
      const poiId = clickedPoi.data('id');
      showEditContextMenu(poiId, e.pageX, e.pageY);
    } else {
      showContextMenu(e.pageX, e.pageY, clickX, clickY);
    }
  });

  $('#context-menu').on('click', function (e) {
    e.stopPropagation();
  });

  $(document).on('click', function (e) {
    if ($(e.target).closest('#context-menu').length === 0) {
      $('#context-menu').hide();
    }
  });

  $('#context-poi-type').on('change', function () {
    const selectedType = $(this).val();
    $(this).css('color', getPoiColor(selectedType));
  });

  $('#poi-type').on('change', function () {
    const selectedType = $(this).val();
    $(this).css('color', getPoiColor(selectedType));
  });

  $('#poi-type').css('color', getPoiColor($('#poi-type').val()));

  $('#map-container').on('wheel', function (e) {
    e.preventDefault();
    const delta = e.originalEvent.deltaY > 0 ? -0.1 : 0.1;
    changeZoom(delta);
  });

  $('.group-checkbox').on('change', function () {
    const type = $(this).data('type');
    const checked = $(this).prop('checked');
    toggleGroupVisibility(type, checked);
  });

  $('#map-container').on('mousemove', function (e) {
    const mapOffset = $('#game-map').offset();

    // Calculate coordinates relative to the map, adjusted for zoom and pan
    const mapX = Math.round((e.pageX - mapOffset.left) / currentZoom);

    // For Y coordinate, we need to flip it since we want 0 at the bottom
    // We calculate from the top, then subtract from the total height to get from bottom
    const mapY = Math.round(MAP_HEIGHT - ((e.pageY - mapOffset.top) / currentZoom));

    // CHANGE THESE LINES to offset the coordinate system
    // Add your custom offsets to change where (0,0) is located
    const offsetX = 200; // Change this to your desired X offset
    const offsetY = 300; // Change this to your desired Y offset

    // Apply the offsets
    const adjustedX = mapX - offsetX;
    const adjustedY = mapY - offsetY;

    // Keep coordinates within bounds (optional)
    const boundedX = Math.max(-offsetX, Math.min(MAP_WIDTH - offsetX, adjustedX));
    const boundedY = Math.max(-offsetY, Math.min(MAP_HEIGHT - offsetY, adjustedY));

    // Update the display with the adjusted coordinates
    $('#coordinates-display').text(`X: ${boundedX}, Y: ${boundedY}`);
  });

  $('#game-map').on('mousemove', function (e) {
    $('#map-container').trigger('mousemove');
  });
});
