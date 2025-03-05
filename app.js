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
        </select>
      </div>
      <div class="context-menu-field">
        <label for="context-poi-note">Note:</label>
        <textarea id="context-poi-note" placeholder="Add a note about this POI (shown on hover)"></textarea>
      </div>
      <div class="context-menu-buttons">
        <button id="context-save-btn">Save</button>
        ${showDeleteButton ? '<button id="context-delete-btn" style="background-color: #f44336;">Delete</button>' : ''}
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
  $('#game-map').css('transform', 
    `scale(${currentZoom}) 
    translate(${mapPosition.x}px, 
    ${mapPosition.y}px)`);

    console.log('transform X', mapPosition.x);
    console.log('transform Y', mapPosition.y);
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

// Function to format coordinates as strings with signs
const formatCoordinateForStorage = (value) => {
    const roundedValue = Math.round(value);
    const sign = roundedValue >= 0 ? '+' : '-';
    return sign + String(Math.abs(roundedValue)).padStart(4, '0');
};

function savePoi() {
  if (!tempPoi) return;

  const poiType = $('#poi-type').val().trim();
  const poiColor = getPoiColor(poiType);

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
  
  if (confirm('Are you sure you want to delete this POI?')) {
    // Remove from local array
    pois = pois.filter(p => p.id !== poiId);
    renderPois();
    savePoisToStorage();
    
    // Send delete request to server for unapproved POIs
    if (poi.approved === false) {
      $.ajax({
        url: `${API_ENDPOINT}/delete-poi`,
        method: 'POST',
        data: JSON.stringify({ id: poiId }),
        contentType: 'application/json',
        success: function(response) {
          console.log('POI deleted from server successfully:', response);
          showNotification('POI deleted successfully');
        },
        error: function(xhr, status, error) {
          console.error('Error deleting POI from server:', error);
          showNotification('POI deleted locally, but failed to delete from server', true);
        }
      });
    } else {
      showNotification('POI deleted successfully');
    }
  }
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
    
    $.ajax({
        url: `${API_ENDPOINT}/save-poi`,  // Use API_ENDPOINT variable
        method: 'POST',
        data: JSON.stringify({
            ...poi,
            action: 'create' // Add an action flag to indicate this is a new POI
        }),
        contentType: 'application/json',
        success: function(response) {
            console.log('POI saved to file successfully:', response);
            
            if (response.success) {
                showNotification('POI saved to draft file');
                
                // Force reload POIs from server to ensure we have the latest data
                loadPoisFromFile();
            } else {
                showNotification('Error saving POI: ' + (response.error || 'Unknown error'), true);
            }
        },
        error: function(xhr, status, error) {
            console.error('Error saving POI to file:', error);
            showNotification('Failed to save POI to file', true);
            
            // Fallback to local storage if server save fails
            const unapprovedPois = JSON.parse(localStorage.getItem('unapproved_pois') || '[]');
            unapprovedPois.push(poi);
            localStorage.setItem('unapproved_pois', JSON.stringify(unapprovedPois));
        }
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

// Rendering functions
function renderPois() {
  $('.poi-marker').remove();
  $('.poi-tooltip').remove();

  const tooltip = $(`<div class="poi-tooltip"></div>`);
  $('body').append(tooltip);

  pois.filter(p => p.visible).forEach(poi => {
      const poiColor = getPoiColor(poi.type);
      
      // Calculate adjusted coordinates for each POI
      //const realX = 585
      //const realY = 1180;

      const realX = (poi.x / 1.664) + offsetX;
      const realY = (poi.y / 1.664) + offsetY + MAP_HEIGHT;

      // Create POI marker with approval status indicator
      const marker = $(`
          <div class="poi-marker ${poi.approved ? 'approved' : 'unapproved'}" data-id="${poi.id}" style="left: ${realX}px; top: ${realY}px;">
              <svg viewBox="0 0 24 24">
                  <path fill="${poiColor}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  ${!poi.approved ? '<circle cx="18" cy="6" r="5" fill="#ff5722" stroke="white" stroke-width="1" />' : ''}
              </svg>
          </div>
      `);

      // Show tooltip with approval status
      marker.on('mouseenter', function (e) {
          const approvalText = poi.approved ? '' : '<div class="approval-status">[Awaiting Approval]</div>';
          tooltip.html(`<div class="tooltip-description">${poi.description}</div>${approvalText}`);
          
          // Calculate position above the marker
          const markerRect = this.getBoundingClientRect();
          const tooltipX = markerRect.left + (markerRect.width / 2);
          const tooltipY = markerRect.top;
          
          tooltip.css({
              left: tooltipX + 'px',
              top: tooltipY + 'px',
              visibility: 'visible',
              opacity: 1
          });
      });

      marker.on('mouseleave', function () {
          tooltip.css({
              visibility: 'hidden',
              opacity: 0
          });
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
  </style>
`);

function getPoiColor(type) {
  const normalizedType = String(type).toLowerCase().trim();
  switch (normalizedType) {
    case 'shelter': return '#ff5252';
    case 'bunker': return '#ff9800';
    case 'machinery': return '#d3d3d3'; // Light gray for Machinery Parts
    case 'fragment': return '#4caf50';
    case 'electronics': return '#2196f3';
    case 'secret': return '#607d8b';
    case 'ec-kits': return '#d8b4e2'; // Light purple for EC Kits
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
    const mapY = Math.round(((e.pageY - mapOffset.top) / currentZoom) - MAP_HEIGHT);

    // Apply the offsets
    const adjustedX = (mapX - offsetX) * 1.664;
    const adjustedY = (mapY - offsetY) * 1.664;

    // Update the display with the adjusted coordinates
    $('#coordinates-display').text(`X: ${formatCoordinate(adjustedX)}, Y: ${formatCoordinate(adjustedY)}`);
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

  if (clickedPoi.length) {
    const poiId = clickedPoi.data('id');
    showEditContextMenu(poiId, e.pageX, e.pageY);
  } else {
    showContextMenu(e.pageX, e.pageY, clickX, clickY);
  }
}
