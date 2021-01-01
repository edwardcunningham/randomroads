var pos = [0, 0];
var heading = 0; // Initial heading, in units of π/2, measured from positive x-axis.
var alive = [[pos, heading]];
var interval = 200; // Milliseconds per generation.

var redraw = true;
var autoFocus = true;
var targetZoom = null;

var dpr = window.devicePixelRatio || 1;
var zoom = dpr;
var translation = [0, 0]; // Will be updated to centre of canvas on first frame.
var rect = new DOMRect();

var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');

// RANDOM NUMBER GENERATOR SETUP

var seed = Date.now();

if (window.location.hash) {
  seed = Number(window.location.hash.substring(1));
  // 1590148148467 - very small.
  // 1589025207625 - small
  // 1589025621423 - big
  // 1589058113269 - massive!
  // 1589058320482 - massive and tall!
}

console.log(seed);
var rng = new Math.seedrandom(seed);

// ZOOM & DRAG CONTROLS

var pointerCache = [];

var dist = (e1, e2) => {
  var deltaX = Math.abs(e1.pageX - e2.pageX);
  var deltaY = Math.abs(e1.pageY - e2.pageY);
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
};

canvas.onpointerdown = event => pointerCache.push(event);
canvas.onpointerup = event => pointerCache = pointerCache.filter(e => e.pointerId != event.pointerId);
canvas.onpointercancel = canvas.onpointerout = canvas.onpointerleave = canvas.onpointerup;

canvas.onpointermove = event => {
  if (pointerCache.length > 0) autoFocus = false;

  if (pointerCache.length == 1) { // Drag.
    // Using .movementX/Y feels cleaner but is double on mobile...
    translation[0] += (event.pageX - pointerCache[0].pageX) * dpr;
    translation[1] += (event.pageY - pointerCache[0].pageY) * dpr;
    redraw = true;
  } else if (pointerCache.length == 2) { // Pinch.
    var otherEvent = pointerCache.find(e => e.pointerId != event.pointerId);
    var prevDist = dist(pointerCache[0], pointerCache[1]);
    var curDist = dist(event, otherEvent);
    var newZoom = safeZoom(zoom * curDist / prevDist);
    zoomCentred(newZoom, otherEvent);
  }

  pointerCache = pointerCache.map(e => e.pointerId == event.pointerId ? event : e);
};

canvas.onwheel = event => {
  event.preventDefault();
  autoFocus = false;
  var newZoom = safeZoom(zoom - event.deltaY * 0.005);
  zoomCentred(newZoom, event);
};

var safeZoom = (z) => Math.min(Math.max(0.1, z), dpr);

var zoomCentred = (newZoom, event) => {
  translation[0] += (1 - (newZoom / zoom)) * (event.pageX * dpr - translation[0]);
  translation[1] += (1 - (newZoom / zoom)) * (event.pageY * dpr - translation[1]);
  zoom = safeZoom(newZoom);
  redraw = true;
};

// MAP STATE

// 2D array to keep track of which parts of the map are visited.
var grid = Array(1001).fill().map(() => Array(1001).fill(true));
var maxX = minX = maxY = minY = 0;

var toGridIndices = pos => {
  let [x, y] = [
    pos[0] + (grid.length - 1) / 2,
    pos[1] + (grid[0].length - 1) / 2
  ];
  return [x, y, x >= 0 && x < grid.length && y >= 0 && y < grid[0].length];
};

var setVisited = pos => {
  maxX = Math.max(maxX, pos[0]);
  minX = Math.min(minX, pos[0]);
  maxY = Math.max(maxY, pos[1]);
  minY = Math.min(minY, pos[1]);
 
  var [x, y, valid] = toGridIndices(pos);
  if (valid) {
    grid[x][y] = false;
  }
};

var canVisit = pos => {
  var [x, y, valid] = toGridIndices(pos);
  if (valid) {
    return grid[x][y];
  } else {
    return false;
  }
};

// DRAWING FUNCTIONS

var drawHistory = [];

var drawAndStore = (f, ...args) => {
  f(...args);
  drawHistory.push([f, args]);
};

var redrawHistory = () => {
  for (const [f, args] of drawHistory) {
    f(...args);
  }
};

var scale = 20;

var drawPos = pos => {
  ctx.beginPath();
  ctx.arc(pos[0] * scale, pos[1] * scale, 0.1 * scale, 0, 2 * Math.PI);
  ctx.fill();
};

var drawStop = pos => {
  ctx.fillRect((pos[0] - 1 / 4) * scale, (pos[1] - 1 / 4) * scale, scale / 2, scale / 2);
} 

var drawRoad = (from, to) => {
  ctx.beginPath();
  ctx.moveTo(from[0] * scale, from[1] * scale);
  ctx.lineTo(to[0] * scale, to[1] * scale);
  ctx.stroke();
};

var drawArc = (centre, quadrant, dir) => {
  ctx.beginPath();
  ctx.arc(
    centre[0] * scale,
    centre[1] * scale,
    scale,
    Math.PI * quadrant / 2,
    Math.PI * (quadrant - dir) / 2,
    dir > 0);
  ctx.stroke();
};

// POSSIBLE MOVES

var add = (pos, angle) => [
  pos[0] + Math.round(Math.cos(angle * Math.PI / 2)),
  pos[1] + Math.round(Math.sin(angle * Math.PI / 2))
];

var straightAhead = (pos, heading, test) => {
  var newPos = add(pos, heading);
  if (!canVisit(newPos)) {
    return [];
  } else {
    if (!test) {
      setVisited(newPos);
      drawAndStore(drawRoad, pos, newPos);
    }
    return [[newPos, heading]];
  }
};

var turn = (pos, heading, test, dir) => {
  var newHeading = heading + dir;
  var outside = add(pos, heading);
  var dest = add(outside, newHeading);
  var centre = add(pos, newHeading);
  if (!canVisit(dest) || !canVisit(outside)) {
    return [];
  } else {
    if (!test) {
      setVisited(outside);
      setVisited(dest);
      setVisited(centre);
      drawAndStore(drawArc, centre, heading, dir);
    }
    return [[dest, newHeading]];
  }
};

var leftTurn = (...args) => turn(...args, -1);
var rightTurn = (...args) => turn(...args, 1);
var hardLeftTurn = (pos, heading, test) => straightAhead(pos, heading - 1, test);
var hardRightTurn = (pos, heading, test) => straightAhead(pos, heading + 1, test);
var tJunction = (...args) => [...hardLeftTurn(...args), ...hardRightTurn(...args)];
var leftCrossroad = (...args) => [...hardLeftTurn(...args), ...straightAhead(...args)];
var rightCrossroad = (...args) => [...hardRightTurn(...args), ...straightAhead(...args)];
var fullCrossroad = (...args) => [...tJunction(...args), ...straightAhead(...args)];

var deadEnd = (pos, _, test) => {
  if (!test) drawAndStore(drawStop, pos);
  return [];
};

// RANDOM MOVE LOGIC 

var choices = [
  // [Weight, Function]
  [5, deadEnd],
  [50, straightAhead],
  [5, leftTurn],
  [5, rightTurn],
  [3, leftCrossroad],
  [3, rightCrossroad],
  [10, fullCrossroad],
  [3, tJunction]
];

// Calculate & store expected output points for each move.
for (let choice of choices) {
  let [_, fn] = choice;
  choice.push(fn(pos, heading, true).length);
}

// Array to help picking weighted choice.
var picker = [];
for (var [i, [weight]] of choices.entries()) {
  picker.push(...Array(weight).fill(i));
}

// Randomly picks next move, returning new position and heading. If the chosen move can't be performed, tries the next one.
var next = (...args) => {
  var rand = Math.floor(rng() * picker.length);
  var offset = picker[rand];

  for (var i = 0; i < choices.length; i++) {
    let [_, fn, expected] = choices[(i + offset) % choices.length];
    if (fn(...args, true).length == expected) {
      return fn(...args, false);
    }
  }

  return deadEnd(pos, heading, false);
};

// ANIMATION LOOP!

var old_t = window.performance.now();
var x = 0; // Contains count of how many fractional steps behind we were in last iteration.

var animate = (t) => {

  requestAnimationFrame(animate);
  
  var curRect = canvas.getBoundingClientRect();

  if (curRect.width != rect.width || curRect.height != rect.height) {
    translation[0] += dpr * (curRect.width - rect.width) / 2;
    translation[1] += dpr * (curRect.height - rect.height) / 2;
    rect = curRect;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    redraw = true;
  }

  if (autoFocus && targetZoom != null) {
    if (zoom / targetZoom < 1.001) {
      zoom = safeZoom(targetZoom);
      targetZoom = null;
    } else {
      zoom = safeZoom(0.95 * zoom + 0.05 * targetZoom);
    }
    redraw = true;
  }

  if (redraw) {
    redraw = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(zoom, 0, 0, zoom, translation[0], translation[1]);
    redrawHistory();
  }
  
  var elapsed = t - old_t;

  // Steps are distributed evenly throughout the generational interval.
  var delay = interval / alive.length;

  if (alive.length > 0 && elapsed >= delay) {
    old_t = t;
    // We may need to do multiple steps per frame (frame rate isn't unlimited).
    x = Math.min(alive.length, x + alive.length * elapsed / interval);
    do {
      alive.push(...next(...alive.shift()));
    } while (--x >= 1);

    if (autoFocus) {
      var right = translation[0] + maxX * scale * zoom;
      var left = translation[0] + minX * scale * zoom;
      var top = translation[1] + maxY * scale * zoom;
      var bottom = translation[1] + minY * scale * zoom;
      
      var exceedsBounds = right > 0.95 * canvas.width
          || left < 0.05 * canvas.width
          || top > 0.95 * canvas.height
          || bottom < 0.05 * canvas.height;

      if (exceedsBounds) targetZoom = safeZoom(zoom * 0.9);
    }

  }

};

drawAndStore(drawPos, pos);
setVisited(pos);

requestAnimationFrame(animate);