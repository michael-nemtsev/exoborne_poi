// Global offsets
let offsetX = 602; // Change this to your desired X offset
let offsetY = -248; // Change this to your desired Y offset

// Configuration
const API_ENDPOINT = 'http://localhost:8080/api'; // Update to match Node.js server URL
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1430;
const STORAGE_KEY = 'game_map_pois';
const DEFAULT_ZOOM = 1;

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

// Format coordinate with sign and padding
const formatCoordinate = (value) => {
  const roundedValue = Math.round(value);
  const sign = roundedValue >= 0 ? '+' : '-';
  return sign + String(Math.abs(roundedValue)).padStart(4, '0');
};

// Check if user has edit permissions based on URL parameter
function hasEditPermission() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('canEdit') === '1';
}

// Update the context menu HTML structure
function updateContextMenuHtml() {
  const showDeleteButton = hasEditPermission();
  
  $('#context-menu').html(`
    <div class="context-menu-form">
      <div class="context-menu-field">
        <label for="context-poi-type" style="display: inline-block;">Type:</label>
        <span id="context-coordinates" style="display: inline-block; margin-left: 10px; color: #ccc; font-size: inherit;">X: 0, Y: 0</span>
        <select id="context-poi-type">
          <option value="shelter">Rebirth Shelter</option>
          <option value="bunker">Rebirth Bunker</option>
          <option value="fragment">Clearance Fragment</option>
          <option value="machinery">Machinery Parts</option>
          <option value="electronics">Electronics</option>
          <option value="secret">Secret</option>
          <option value="ec-kits">EC Kits</option>
          <option value="collectibles">Collectibles</option>
          <option value="loot">Loot</option>
        </select>
      </div>
      <div class="context-menu-field">
        <label for="context-poi-note">Note:</label>
        <textarea id="context-poi-note" placeholder="Add a note about this POI (shown on hover)"></textarea>
      </div>
      <div class="context-menu-buttons">
        <button id="context-save-btn">Save</button>
        ${showDeleteButton ? '<button id="context-delete-btn" style="background-color: #f44336;">Delete</button>' : ''}
        <button id="context-approve-btn" style="background-color: #4CAF50; display: none;">Approve</button>
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

  $('#context-approve-btn').off('click').on('click', function () {
    const poiId = $('#context-menu').data('poi-id');
    if (poiId) {
      approvePoi(poiId);
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
  
  // Initialize zoom indicator
  updateZoomIndicator();

  // Mouse events for dragging
  mapElement.on('mousedown', startDragging);
  $(document).on('mousemove', dragMap);
  $(document).on('mouseup', stopDragging);

  // Map controls
  $('#zoom-in').on('click', () => {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    changeZoom(0.2, containerWidth / 2, containerHeight / 2);
  });

  $('#zoom-out').on('click', () => {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    changeZoom(-0.2, containerWidth / 2, containerHeight / 2);
  });

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
  showNotification('Loading POIs from server...');
  
  // Load both approved and draft POIs
  Promise.all([
    // Load approved POIs
    $.ajax({
      url: `${API_ENDPOINT}/pois-approved`,
      method: 'GET',
      dataType: 'json'
    }).catch(error => {
      console.error('Error loading approved POIs:', error);
      showNotification('Error loading approved POIs', true);
      return []; // Return empty array if file doesn't exist or has error
    }),
    
    // Load draft POIs
    $.ajax({
      url: `${API_ENDPOINT}/pois-draft`,
      method: 'GET',
      dataType: 'json'
    }).catch(error => {
      console.error('Error loading draft POIs:', error);
      showNotification('Error loading draft POIs', true);
      return []; // Return empty array if file doesn't exist or has error
    })
  ])
  .then(([approvedPois, draftPois]) => {
    console.log('Loaded POIs:', { approved: approvedPois.length, draft: draftPois.length });
    
    // Process the POIs to ensure they have approval status and remove any action property
    const processedApproved = approvedPois.map(poi => {
      // Remove action property if it exists
      const { action, ...cleanPoi } = poi;
      return {
        ...cleanPoi,
        approved: true // Ensure approved status for main POIs
      };
    });

    const processedDraft = draftPois.map(poi => {
      // Remove action property if it exists
      const { action, ...cleanPoi } = poi;
      return {
        ...cleanPoi,
        approved: false // Ensure unapproved status for draft POIs
      };
    });

    // Create a map to track POIs by ID to avoid duplicates
    const poiMap = new Map();
    
    // Add approved POIs first
    processedApproved.forEach(poi => {
      poiMap.set(poi.id, poi);
    });
    
    // Add draft POIs, which will override any approved POIs with the same ID
    processedDraft.forEach(poi => {
      poiMap.set(poi.id, poi);
    });
    
    // Convert map back to array
    pois = Array.from(poiMap.values());
    
    renderPois();
    savePoisToStorage();
    
    // Update last sync time
    lastSyncTime = Date.now();
    
    showNotification(`Loaded ${pois.length} POIs successfully`);
  })
  .catch(error => {
    console.error('Error in POI loading process:', error);
    showNotification('Error loading POIs from server', true);
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

function changeZoom(delta, cursorX, cursorY) {
  const oldZoom = currentZoom;
  
  // Update max zoom to 4 (2x beyond native resolution)
  currentZoom = Math.max(0.2, Math.min(4, currentZoom + delta));

  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();

  // If cursor position is provided, zoom towards that point
  // Otherwise, zoom towards the center of the viewport
  let centerX, centerY;
  if (cursorX !== undefined && cursorY !== undefined) {
    centerX = cursorX;
    centerY = cursorY;
  } else {
    centerX = containerWidth / 2;
    centerY = containerHeight / 2;
  }

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
  
  // Update zoom level indicator if it exists
  updateZoomIndicator();
}

function updateMapTransform() {
  // Add transition for smoother zooming
  $('#game-map').css({
    'transition': 'transform 0.2s ease-out',
    'transform': `scale(${currentZoom}) translate(${mapPosition.x}px, ${mapPosition.y}px)`
  });
  
  // Remove transition after a short delay to avoid affecting dragging
  setTimeout(() => {
    $('#game-map').css('transition', 'none');
  }, 200);
}

function resetMapView() {
  const containerWidth = $('#map-container').width();
  const containerHeight = $('#map-container').height();

  currentZoom = DEFAULT_ZOOM;

  mapPosition.x = (containerWidth / currentZoom - MAP_WIDTH) / 2;
  mapPosition.y = (containerHeight / currentZoom - MAP_HEIGHT) / 2;

  updateMapTransform();
  
  // Update zoom indicator
  updateZoomIndicator();
}

// POI management functions
function toggleAddMode() {
  addMode = !addMode;
  $('#add-mode-btn').toggleClass('active', addMode);

  if (addMode) {
    $('#game-map').css('cursor', 'crosshair');
    $('#poi-form').show();
    $('#poi-x').val('');
    $('#poi-y').val('');
    $('#poi-desc').val('');
    showNotification('Click on the map to add a POI or enter coordinates manually');
  } else {
    $('#game-map').css('cursor', 'move');
    $('#poi-form').hide();
    tempPoi = null;
  }
}

// Function to format coordinates as strings with signs
const formatCoordinateForStorage = (value) => {
    const roundedValue = Math.round(value);
    const sign = roundedValue >= 0 ? '+' : '-';
    return sign + String(Math.abs(roundedValue)).padStart(4, '0');
};

function savePoi() {
  const poiType = $('#poi-type').val().trim();
  const poiColor = getPoiColor(poiType);
  const manualX = $('#poi-x').val().trim();
  const manualY = $('#poi-y').val().trim();
  
  // Check if coordinates were manually entered
  if (manualX && manualY) {
    // Create POI with manually entered coordinates
    const poi = {
      id: 'poi-' + Date.now(),
      name: poiType.charAt(0).toUpperCase() + poiType.slice(1),
      type: poiType,
      description: $('#poi-desc').val().trim(),
      x: manualX.startsWith('+') || manualX.startsWith('-') ? manualX : '+' + manualX,
      y: manualY.startsWith('+') || manualY.startsWith('-') ? manualY : '+' + manualY,
      visible: true,
      approved: false,
      dateAdded: new Date().toISOString()
    };
    
    pois.push(poi);
    renderPois();
    savePoisToStorage();
    
    // Send unapproved POI to server
    saveUnapprovedPoi(poi);
    
    // Reset form and exit add mode
    $('#poi-form').hide();
    $('#poi-desc').val('');
    $('#poi-x').val('');
    $('#poi-y').val('');
    tempPoi = null;
    addMode = false;
    $('#add-mode-btn').removeClass('active');
    $('#game-map').css('cursor', 'move');
    
    showNotification('POI added successfully (awaiting approval)');
    
    return;
  }
  
  // If no manual coordinates, use the tempPoi from map click
  if (!tempPoi) return;

  // Calculate adjusted coordinates for saving
  const adjustedX = (tempPoi.x - offsetX) * 1.664;
  const adjustedY = (tempPoi.y - offsetY) * 1.664;

  const poi = {
    id: 'poi-' + Date.now(),
    name: tempPoi.name,
    type: poiType,
    description: $('#poi-desc').val().trim(),
    x: formatCoordinateForStorage(adjustedX),
    y: formatCoordinateForStorage(adjustedY),
    visible: true,
    approved: false, // Mark new POIs as unapproved
    dateAdded: new Date().toISOString()
  };

  pois.push(poi);
  renderPois();
  savePoisToStorage();
  
  // Send unapproved POI to server
  saveUnapprovedPoi(poi);

  // Reset form and add mode
  $('#poi-form').hide();
  tempPoi = null;
  addMode = false;
  $('#add-mode-btn').removeClass('active');
  $('#game-map').css('cursor', 'move');

  showNotification('POI added successfully (awaiting approval)');
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
  // If the POI is already selected, don't do anything
  if (selectedPoi === id) return;
  
  selectedPoi = id;
  
  // Update the visual state of all POI markers
  $('.poi-marker').removeClass('selected');
  $(`.poi-marker[data-id="${id}"]`).addClass('selected');
  
  const poi = pois.find(p => p.id === id);
  if (poi) {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    const poiScreenX = poi.x * currentZoom + mapPosition.x * currentZoom;
    const poiScreenY = poi.y * currentZoom + mapPosition.y * currentZoom;

    const margin = 100;
    const isOutsideX = poiScreenX < margin || poiScreenX > containerWidth - margin;
    const isOutsideY = poiScreenY < margin || poiScreenY > containerHeight - margin;

    // DUNNO WHY WE HAVE IT HERE - it breaks the zoom when editing
    /*
    if (isOutsideX || isOutsideY) {
      mapPosition = {
        x: containerWidth / (2 * currentZoom) - poi.x,
        y: containerHeight / (2 * currentZoom) - poi.y
      };
      updateMapTransform();
    }
    */
  }
}

function deletePoi(poiId) {
  const poi = pois.find(p => p.id === poiId);
  if (!poi) return;
  
  // Check if this is an approved POI
  if (poi.approved === true) {
    showNotification('Cannot delete approved POIs', true);
    return;
  }
  
  // Confirm deletion
  if (!confirm(`Are you sure you want to delete this POI?\n\nType: ${poi.type}\nCoordinates: X: ${poi.x}, Y: ${poi.y}`)) {
    return;
  }
  
  // Remove from local array
  pois = pois.filter(p => p.id !== poiId);

  // Send delete request to server for unapproved POIs
  if (poi.approved === false) {
    fetch(`${API_ENDPOINT}/delete-poi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: poiId }),
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showNotification('POI deleted successfully');
        renderPois();
      } else {
        showNotification('Error deleting POI: ' + data.error, true);
      }
    })
    .catch(error => {
      console.error('Error deleting POI:', error);
      showNotification('Error deleting POI', true);
    });
  } else {
    renderPois();
  }
}

// Function to approve a POI
function approvePoi(poiId) {
  // Check if user has edit permission
  if (!hasEditPermission()) {
    showNotification('You do not have permission to approve POIs', true);
    return;
  }

  const poi = pois.find(p => p.id === poiId);
  if (!poi) return;

  // Check if this POI is already approved
  if (poi.approved === true) {
    showNotification('This POI is already approved', true);
    return;
  }

  // Confirm approval
  if (!confirm(`Are you sure you want to approve this POI?\n\nType: ${poi.type}\nCoordinates: X: ${poi.x}, Y: ${poi.y}`)) {
    return;
  }

  // Create a copy of the POI with approved status
  const approvedPoi = { ...poi, approved: true };

  // Show loading notification
  showNotification('Approving POI...');

  // Send approval request to server
  fetch(`${API_ENDPOINT}/approve-poi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(approvedPoi),
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    return response.json();
  })
  .then(data => {
    if (data.success) {
      // Update local POI
      const index = pois.findIndex(p => p.id === poiId);
      if (index !== -1) {
        pois[index] = { ...pois[index], approved: true };
      }
      
      showNotification('POI approved successfully');
      
      // Refresh POIs from server to ensure we have the latest data
      loadPoisFromFile();
    } else {
      showNotification('Error approving POI: ' + (data.error || 'Unknown error'), true);
    }
  })
  .catch(error => {
    console.error('Error approving POI:', error);
    showNotification('Error approving POI: ' + error.message, true);
    
    // Fallback: Update locally if server request fails
    const index = pois.findIndex(p => p.id === poiId);
    if (index !== -1) {
      pois[index] = { ...pois[index], approved: true };
      showNotification('POI approved locally (server update failed)');
      renderPois();
    }
  });
}

// Context menu functions and saving/editing POIs
function showContextMenu(screenX, screenY, mapX, mapY) {
  const contextMenu = $('#context-menu');
  updateContextMenuHtml();

  // Get dimensions
  const menuWidth = contextMenu.outerWidth();
  const menuHeight = contextMenu.outerHeight();
  const windowWidth = $(window).width();
  const windowHeight = $(window).height();

  // Calculate position to keep menu within viewport
  let posX = screenX;
  let posY = screenY;

  // Adjust X position if menu would go off screen
  if (screenX + menuWidth > windowWidth) {
    posX = windowWidth - menuWidth - 10; // 10px padding from edge
  }
  if (screenX < 0) {
    posX = 10;
  }

  // Adjust Y position if menu would go off screen
  if (screenY + menuHeight > windowHeight) {
    posY = windowHeight - menuHeight - 10;
  }
  if (screenY < 0) {
    posY = 10;
  }

  $('#context-poi-type').val('shelter');
  $('#context-poi-note').val('');
  $('#context-delete-btn').hide();

  // Update coordinates display
  $('#context-coordinates').text(`X: ${formatCoordinate(mapX)}, Y: ${formatCoordinate(mapY)}`);

  $('#context-poi-type').css('color', getPoiColor($('#context-poi-type').val()));

  const adjustedX = (mapX - offsetX) * 1.664;
  const adjustedY = (mapY - offsetY - MAP_HEIGHT) * 1.664;

  contextMenu.data('map-x', adjustedX);
  contextMenu.data('map-y', adjustedY);

  contextMenu.css({
    top: posY + 'px',
    left: posX + 'px'
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

  // Get dimensions
  const menuWidth = contextMenu.outerWidth();
  const menuHeight = contextMenu.outerHeight();
  const windowWidth = $(window).width();
  const windowHeight = $(window).height();

  // Calculate position to keep menu within viewport
  let posX = screenX;
  let posY = screenY;

  // Adjust X position if menu would go off screen
  if (screenX + menuWidth > windowWidth) {
    posX = windowWidth - menuWidth - 10;
  }
  if (screenX < 0) {
    posX = 10;
  }

  // Adjust Y position if menu would go off screen
  if (screenY + menuHeight > windowHeight) {
    posY = windowHeight - menuHeight - 10;
  }
  if (screenY < 0) {
    posY = 10;
  }

  $('#context-poi-type').val(poi.type);
  $('#context-poi-note').val(poi.description || '');
  
  // Only show delete button if user has edit permission
  if (hasEditPermission()) {
    $('#context-delete-btn').show();
  }
  
  contextMenu.data('poi-id', poiId);

  // Update coordinates display with the POI's coordinates
  $('#context-coordinates').text(`X: ${poi.x}, Y: ${poi.y}`);

  // Disable editing for approved POIs
  if (poi.approved === true) {
    $('#context-poi-type').prop('disabled', true).css('opacity', '0.6');
    $('#context-poi-note').prop('disabled', true).css('opacity', '0.6');
    $('#context-save-btn').prop('disabled', true).css('opacity', '0.6');
    $('#context-delete-btn').prop('disabled', true).css('opacity', '0.6');
    $('#context-approve-btn').hide();

    // Add a notice that approved POIs cannot be edited (with smaller font)
    contextMenu.find('.context-menu-form').prepend(
      '<div class="approved-notice" style="color: #ff9800; margin-bottom: 8px; font-size: 12px; font-style: italic;">Approved POI and cannot be edited.</div>'
    );
  } else {
    // Enable controls for unapproved POIs
    $('#context-poi-type').prop('disabled', false).css('opacity', '1');
    $('#context-poi-note').prop('disabled', false).css('opacity', '1');
    $('#context-save-btn').prop('disabled', false).css('opacity', '1');
    $('#context-delete-btn').prop('disabled', false).css('opacity', '1');
    
    // Show approve button for unapproved POIs if user has edit permission
    if (hasEditPermission()) {
      $('#context-approve-btn').show();
    } else {
      $('#context-approve-btn').hide();
    }
    
    // Remove the notice if it exists
    contextMenu.find('.approved-notice').remove();
  }

  $('#context-poi-type').css('color', getPoiColor(poi.type));

  contextMenu.css({
    top: posY + 'px',
    left: posX + 'px',
    display: 'block'
  });

  $('#context-delete-btn').show();
}

// Update context menu POI saving logic
function saveContextMenuPoi() {
  const contextMenu = $('#context-menu');
  const mapX = contextMenu.data('map-x');
  const mapY = contextMenu.data('map-y');

  const name = `POI-${Date.now().toString().slice(-4)}`;
  const type = document.getElementById('context-poi-type').value;
  const description = $('#context-poi-note').val().trim();

  const poi = {
      id: 'poi-' + Date.now(),
      name: name,
      type: type,
      description: description,
      x: formatCoordinateForStorage(mapX),
      y: formatCoordinateForStorage(mapY),
      visible: true,
      approved: false, // Mark new POIs as unapproved
      dateAdded: new Date().toISOString()
  };

  // Add to local array temporarily
  pois.push(poi);
  renderPois();
  
  // Send unapproved POI to server
  saveUnapprovedPoi(poi);
  
  contextMenu.hide();
  
  // Select the new POI after adding it
  selectPoi(poi.id);
}

// Function to save unapproved POIs to the server
function saveUnapprovedPoi(poi) {
    // Show loading notification
    showNotification('Saving new POI...');
    
    // Make a copy of the POI to avoid modifying the original
    const poiToSave = { ...poi };
    
    // Ensure the POI has approved=false
    poiToSave.approved = false;
    
    fetch(`${API_ENDPOINT}/save-poi`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...poiToSave,
            action: 'create' // Add an action flag to indicate this is a new POI
        }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('POI saved to file successfully:', data);
        
        if (data.success) {
            showNotification('POI saved to draft file');
            
            // Force reload POIs from server to ensure we have the latest data
            loadPoisFromFile();
        } else {
            showNotification('Error saving POI: ' + (data.error || 'Unknown error'), true);
            console.error('Server reported error:', data.error);
            
            // Fallback to local storage if server save fails
            const unapprovedPois = JSON.parse(localStorage.getItem('unapproved_pois') || '[]');
            unapprovedPois.push(poi);
            localStorage.setItem('unapproved_pois', JSON.stringify(unapprovedPois));
        }
    })
    .catch(error => {
        console.error('Error saving POI to file:', error);
        showNotification('Failed to save POI to file: ' + error.message, true);
        
        // Fallback to local storage if server save fails
        const unapprovedPois = JSON.parse(localStorage.getItem('unapproved_pois') || '[]');
        unapprovedPois.push(poi);
        localStorage.setItem('unapproved_pois', JSON.stringify(unapprovedPois));
    });
}

function saveEditedPoi() {
  const contextMenu = $('#context-menu');
  const poiId = contextMenu.data('poi-id');

  const poi = pois.find(p => p.id === poiId);
  if (!poi) return;

  // Additional safety check - don't allow editing approved POIs
  if (poi.approved === true) {
    showNotification('Cannot edit approved POIs', true);
    contextMenu.hide();
    return;
  }

  // Update POI properties
  poi.type = $('#context-poi-type').val();
  poi.description = $('#context-poi-note').val().trim();
  poi.lastEdited = new Date().toISOString(); // Add last edited timestamp

  // If this is an unapproved POI, send the updated version to the server
  if (poi.approved === false) {
    // Show loading notification
    showNotification('Saving changes...');
    
    // Send the updated POI to the server
    $.ajax({
      url: `${API_ENDPOINT}/save-poi`,
      method: 'POST',
      data: JSON.stringify({
        ...poi,
        action: 'update' // Add an action flag to indicate this is an update
      }),
      contentType: 'application/json',
      success: function(response) {
        console.log('POI updated on server successfully:', response);
        
        if (response.success) {
          showNotification('POI updated successfully (awaiting approval)');
          
          // Update the local POI with the server response
          if (response.pois && Array.isArray(response.pois)) {
            // Find the updated POI in the response
            const updatedPoi = response.pois.find(p => p.id === poiId);
            if (updatedPoi) {
              // Update the local POI with the server version
              Object.assign(poi, updatedPoi);
            }
          }
          
          // Render the updated POIs
          renderPois();
          savePoisToStorage();
          
        } else {
          showNotification('Error updating POI: ' + (response.error || 'Unknown error'), true);
        }
      },
      error: function(xhr, status, error) {
        console.error('Error updating POI on server:', error);
        showNotification('POI updated locally, but failed to update on server', true);
        
        // Still update local storage even if server update fails
        renderPois();
        savePoisToStorage();
      }
    });
  } else {
    // For approved POIs, just update locally
    renderPois();
    savePoisToStorage();
    showNotification('POI updated successfully');
  }
  
  contextMenu.hide();
  selectPoi(poiId);
}

// Function to find overlapping POIs at a specific location
function findOverlappingPois(x, y, threshold = 10) {
  // Convert coordinates to screen coordinates
  const screenX = (x / 1.664) + offsetX;
  const screenY = (y / 1.664) + offsetY + MAP_HEIGHT;
  
  // Find all POIs that are within the threshold distance
  return pois.filter(p => p.visible && 
    Math.abs((p.x / 1.664) + offsetX - screenX) < threshold && 
    Math.abs((p.y / 1.664) + offsetY + MAP_HEIGHT - screenY) < threshold);
}

// Rendering functions
function renderPois() {
  $('.poi-marker').remove();
  $('.poi-tooltip').remove();

  const tooltip = $(`<div class="poi-tooltip"></div>`);
  $('body').append(tooltip);

  // Sort POIs to ensure selected POI is rendered on top
  const sortedPois = [...pois].sort((a, b) => {
    // Selected POI should be last (rendered on top)
    if (a.id === selectedPoi) return 1;
    if (b.id === selectedPoi) return -1;
    return 0;
  });

  sortedPois.filter(p => p.visible).forEach(poi => {
      const poiColor = getPoiColor(poi.type);
      
      // Calculate adjusted coordinates for each POI
      //const realX = 585
      //const realY = 1180;

      const realX = (poi.x / 1.664) + offsetX;
      const realY = (poi.y / 1.664) + offsetY + MAP_HEIGHT;

      // Create POI marker with approval status indicator
      const marker = $(`
          <div class="poi-marker ${poi.approved ? 'approved' : 'unapproved'} ${poi.id === selectedPoi ? 'selected' : ''}" 
               data-id="${poi.id}" 
               style="left: ${realX}px; top: ${realY}px;">
              <svg viewBox="0 0 24 24">
                  <path fill="transparent" 
                        stroke="${poiColor}" 
                        stroke-width="1.5"
                        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  ${!poi.approved ? '<circle cx="18" cy="6" r="5" fill="#ff5722" stroke="white" stroke-width="1" />' : ''}
              </svg>
          </div>
      `);

      // Show tooltip with approval status
      marker.on('mouseenter', function (e) {
          let shouldShowTooltip = false;
          let tooltipContent = '';
          
          // Determine if and what tooltip content to show
          if (poi.description && poi.description.trim() !== '') {
              // Show description and approval status if needed
              const approvalText = poi.approved ? '' : '<div class="approval-status">[Awaiting Approval]</div>';
              tooltipContent = `<div class="tooltip-description">${poi.description}</div>${approvalText}`;
              shouldShowTooltip = true;
          } else if (!poi.approved) {
              // If no description but awaiting approval, only show approval status
              tooltipContent = '<div class="approval-status">[Awaiting Approval]</div>';
              shouldShowTooltip = true;
          }
          
          if (shouldShowTooltip) {
              // Update tooltip content
              tooltip.html(tooltipContent);
              
              // Calculate position above the marker
              const markerRect = this.getBoundingClientRect();
              const tooltipX = markerRect.left + (markerRect.width / 2);
              const tooltipY = markerRect.top;
              
              // Show tooltip
              tooltip.css({
                  left: tooltipX + 'px',
                  top: tooltipY + 'px',
                  visibility: 'visible',
                  opacity: 1
              });
          } else {
              // Hide tooltip if no content to show
              tooltip.css({
                  visibility: 'hidden',
                  opacity: 0
              });
          }
      });

      marker.on('mouseleave', function () {
          tooltip.css({
              visibility: 'hidden',
              opacity: 0
          });
      });

      // Add click handler for cycling through overlapping POIs
      marker.on('click', function(e) {
          e.stopPropagation(); // Prevent the map click handler from firing
          
          const clickedPoiId = $(this).data('id');
          const clickedPoi = pois.find(p => p.id === clickedPoiId);
          
          if (clickedPoi) {
              // Find all overlapping POIs
              const overlappingPois = findOverlappingPois(clickedPoi.x, clickedPoi.y);
              
              if (overlappingPois.length > 1) {
                  // If there are overlapping POIs and one is already selected
                  if (selectedPoi) {
                      // Find the index of the currently selected POI
                      const currentIndex = overlappingPois.findIndex(p => p.id === selectedPoi);
                      
                      // Select the next POI in the list (or the first if at the end)
                      const nextIndex = (currentIndex + 1) % overlappingPois.length;
                      selectPoi(overlappingPois[nextIndex].id);
                      
                      // Show a notification about cycling
                      if (overlappingPois.length > 2) {
                          showNotification(`Cycling through ${overlappingPois.length} overlapping POIs (${nextIndex + 1}/${overlappingPois.length})`, false);
                      }
                  } else {
                      // If no POI is selected, select the clicked one
                      selectPoi(clickedPoiId);
                      
                      // Show a notification about multiple POIs
                      if (overlappingPois.length > 1) {
                          showNotification(`${overlappingPois.length} overlapping POIs found. Click again to cycle through them.`, false);
                      }
                  }
              } else {
                  // If there's only one POI, simply select it
                  selectPoi(clickedPoiId);
              }
          }
      });

      // Add right-click handler for editing POIs
      marker.on('contextmenu', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const poiId = $(this).data('id');
          selectPoi(poiId); // Select the POI that was right-clicked
          showEditContextMenu(poiId, e.pageX, e.pageY);
      });

      // Add double-click handler as an alternative way to edit POIs
      marker.on('dblclick', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const poiId = $(this).data('id');
          selectPoi(poiId); // Select the POI that was double-clicked
          showEditContextMenu(poiId, e.pageX, e.pageY);
      });

      $('#game-map').append(marker);
  });
}

$('head').append(`
  <style>
      .poi-marker.unapproved {
          opacity: 0.7;
      }
      .poi-marker.unapproved svg {
          filter: saturate(0.7);
      }
      .poi-marker.unapproved svg path {
          stroke-dasharray: 2, 1;
      }
  </style>
`);

function getPoiColor(type) {
  const normalizedType = String(type).toLowerCase().trim();
  switch (normalizedType) {
    case 'shelter': return '#ffd700'; // Gold for Rebirth Shelter
    case 'bunker': return '#ff8c00'; // Dark orange for Rebirth Bunker (more visible than dark gold)
    case 'fragment': return '#32cd32'; // Lime green (more vibrant than previous green)
    case 'machinery': return '#a9a9a9'; // Darker gray for Machinery Parts (more visible)
    case 'electronics': return '#1e90ff'; // Dodger blue (slightly more vibrant)
    case 'secret': return '#4682b4'; // Steel blue (more vibrant than previous gray-blue)
    case 'ec-kits': return '#da70d6'; // Orchid (more vibrant than light purple)
    case 'collectibles': return '#ff69b4'; // Hot pink (more vibrant than light pink)
    case 'loot': return '#9932cc'; // Dark orchid (more vibrant purple)
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

  // Show unapproved button if user has edit permissions
  if (hasEditPermission()) {
    $('#show-unapproved-btn').show();
  }

  // Add this new event listener for ESC key
  $(document).on('keydown', function(e) {
    if (e.key === 'Escape') {
      $('#context-menu').hide();
    }
  });

  // Add event listener for right-click (context menu)
  $('#game-map').on('contextmenu', function (e) {
    e.preventDefault();
    handleMapClick(e);
  });

  // Add event listener for double left-click
  $('#game-map').on('dblclick', function (e) {
    e.preventDefault();
    handleMapClick(e);
  });

  // Add event listener for regular click to deselect pins
  $('#game-map').on('click', function (e) {
    // Only proceed if we didn't click on a POI marker
    if ($(e.target).closest('.poi-marker').length === 0) {
      // Deselect any selected POI
      if (selectedPoi) {
        selectedPoi = null;
        $('.poi-marker').removeClass('selected');
      }
    }
  });
  
  // Add event listener for clicks on the map container (but outside the game-map)
  $('#map-container').on('click', function (e) {
    // Only handle clicks directly on the map container (not on its children)
    // Also ignore clicks on map controls
    if (e.target === this && !$(e.target).closest('.map-controls').length) {
      // Check if we clicked on the coordinates display
      if (!$(e.target).closest('#coordinates-display').length) {
        // Deselect any selected POI
        if (selectedPoi) {
          selectedPoi = null;
          $('.poi-marker').removeClass('selected');
        }
      }
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
    
    // Calculate zoom delta based on wheel direction and current zoom level
    // This makes zooming more responsive at different zoom levels
    const zoomFactor = 0.15; // Base zoom factor
    const direction = e.originalEvent.deltaY > 0 ? -1 : 1;
    
    // Scale the zoom factor based on current zoom level
    // This makes zooming more precise at higher zoom levels
    const scaledDelta = direction * zoomFactor * (currentZoom < 1 ? 0.5 : 1);
    
    // Get cursor position relative to the map container
    const cursorX = e.pageX - $(this).offset().left;
    const cursorY = e.pageY - $(this).offset().top;
    
    // Pass cursor position to changeZoom for zooming towards cursor
    changeZoom(scaledDelta, cursorX, cursorY);
  });

  $('.group-checkbox').on('change', function () {
    const type = $(this).data('type');
    const checked = $(this).prop('checked');
    toggleGroupVisibility(type, checked);
  });

  // Handle Select All button
  $('#select-all-btn').on('click', function() {
    $('.group-checkbox').prop('checked', true).trigger('change');
  });

  // Handle Select None button
  $('#select-none-btn').on('click', function() {
    $('.group-checkbox').prop('checked', false).trigger('change');
  });

  // Handle Select Only buttons
  $('.select-only-btn').on('click', function(e) {
    e.stopPropagation(); // Prevent triggering the checkbox click
    const selectedType = $(this).data('type');
    
    // Uncheck all checkboxes
    $('.group-checkbox').prop('checked', false).trigger('change');
    
    // Check only the selected one
    $(`.group-checkbox[data-type="${selectedType}"]`).prop('checked', true).trigger('change');
  });

  // Show only POIs of a specific type
  $('.select-only-btn').on('click', function () {
    const type = $(this).data('type');
    
    // Uncheck all group checkboxes
    $('.group-checkbox').prop('checked', false);
    
    // Check only the selected type
    $(`#group-${type}`).prop('checked', true);
    
    // Update POI visibility
    pois.forEach(poi => {
      poi.visible = (poi.type === type);
    });
    
    renderPois();
    savePoisToStorage();
  });

  // Show only unapproved POIs
  $('#show-unapproved-btn').on('click', function () {
    // Uncheck all group checkboxes
    $('.group-checkbox').prop('checked', false);
    
    // Update POI visibility to show only unapproved POIs
    pois.forEach(poi => {
      poi.visible = !poi.approved;
    });
    
    renderPois();
    savePoisToStorage();
    showNotification('Showing only unapproved POIs');
  });

  $('#map-container').on('mousemove', function (e) {
    const mapOffset = $('#game-map').offset();
    const mapX = Math.round((e.pageX - mapOffset.left) / currentZoom);
    const mapY = Math.round(((e.pageY - mapOffset.top) / currentZoom) - MAP_HEIGHT);
  
    // Apply the offsets
    const adjustedX = (mapX - offsetX) * 1.664;
    const adjustedY = (mapY - offsetY) * 1.664;

    // Determine precision based on zoom level
    // Higher zoom = more decimal places
    const precision = currentZoom > 2 ? 2 : (currentZoom > 1 ? 1 : 0);
    
    // Format coordinates with appropriate precision
    const formattedX = formatCoordinateWithPrecision(adjustedX, precision);
    const formattedY = formatCoordinateWithPrecision(adjustedY, precision);

    // Update the display with the adjusted coordinates
    $('#coordinates-display').text(`X: ${formattedX}, Y: ${formattedY}`);
  });

  $('#game-map').on('mousemove', function (e) {
    $('#map-container').trigger('mousemove');
  });
});

// Function to handle map click events for both right-click and double-click
function handleMapClick(e) {
  const mapOffset = $('#game-map').offset();
  const clickX = (e.pageX - mapOffset.left) / currentZoom;
  const clickY = (e.pageY - mapOffset.top) / currentZoom;
  const clickedPoi = $(e.target).closest('.poi-marker');

  if (addMode) {
    handleAddModeClick(e);
    return;
  }

  if (clickedPoi.length) {
    // POI clicks are now handled by the POI marker click handler
    // This prevents double handling of the click event
    return;
  } else {
    // If clicking on empty space, deselect any selected POI
    if (selectedPoi) {
      selectedPoi = null;
      $('.poi-marker').removeClass('selected');
    }
    
    // Only show context menu for right-click or double-click
    // This is determined by the event type that triggered this function
    if (e.type === 'contextmenu' || e.type === 'dblclick') {
      showContextMenu(e.pageX, e.pageY, clickX, clickY);
    }
  }
}

// Function to handle clicks when in add mode
function handleAddModeClick(e) {
  const mapOffset = $('#game-map').offset();
  const mapX = Math.round((e.pageX - mapOffset.left) / currentZoom);
  const mapY = Math.round(((e.pageY - mapOffset.top) / currentZoom) - MAP_HEIGHT);

  // Apply the offsets
  const adjustedX = (mapX - offsetX) * 1.664;
  const adjustedY = (mapY - offsetY) * 1.664;

  // Format coordinates for display
  const formattedX = formatCoordinate(adjustedX);
  const formattedY = formatCoordinate(adjustedY);

  // Update the coordinate input fields
  $('#poi-x').val(formattedX);
  $('#poi-y').val(formattedY);

  // Store the original coordinates for later use if needed
  tempPoi = {
    x: mapX,
    y: mapY,
    name: 'New POI'
  };

  // Show the form if it's not already visible
  $('#poi-form').show();
}

// Function to update zoom level indicator
function updateZoomIndicator() {
  // Create zoom indicator if it doesn't exist
  if ($('#zoom-level').length === 0) {
    const zoomIndicator = $('<div id="zoom-level"></div>');
    zoomIndicator.css({
      'position': 'absolute',
      'bottom': '10px',
      'left': '10px',
      'background-color': 'rgba(0, 0, 0, 0.7)',
      'color': 'white',
      'padding': '5px 10px',
      'border-radius': '4px',
      'z-index': '20',
      'font-size': '14px'
    });
    $('#map-container').append(zoomIndicator);
  }
  
  // Update zoom level text
  const zoomPercent = Math.round(currentZoom * 100);
  $('#zoom-level').text(`Zoom: ${zoomPercent}%`);
}

// Add keyboard shortcuts for zooming
$(document).on('keydown', function(e) {
  // Only handle keyboard shortcuts if not typing in an input field
  if (!$(e.target).is('input, textarea, select')) {
    const containerWidth = $('#map-container').width();
    const containerHeight = $('#map-container').height();
    
    // Plus key (+) to zoom in
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      changeZoom(0.2, containerWidth / 2, containerHeight / 2);
    }
    // Minus key (-) to zoom out
    else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      changeZoom(-0.2, containerWidth / 2, containerHeight / 2);
    }
    // 0 key to reset view
    else if (e.key === '0') {
      e.preventDefault();
      resetMapView();
    }
  }
});

// Format coordinate with specified decimal precision
function formatCoordinateWithPrecision(value, precision) {
  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(precision);
}
