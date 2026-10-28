square = [
  [-7.5, -7.5],
  [7.5, -7.5],
  [7.5, 7.5],
  [-7.5, 7.5],
];

grass_floor = floorTexture("grass1");
leaves_floor = floorTexture("forest_leaves");
pebble_floor = floorTexture("river_pebbles");
sand_floor = floorTexture("gravelly_sand");
mud_floor = floorTexture("red_mud_stones");
snow_floor = floorTexture("snow");

PolygonFace("front", grass_floor, square);
PolygonFace("right", leaves_floor, square);
PolygonFace("back", pebble_floor, square);
PolygonFace("left", sand_floor, square);
PolygonFace("top", mud_floor, square);
PolygonFace("bottom", snow_floor, square);

Portal("front", 0, "bottom", 2);
Portal("front", 1, "right", 3);
Portal("front", 2, "top", 0);
Portal("front", 3, "left", 1);
Portal("right", 0, "bottom", 1);
Portal("right", 1, "back", 3);
Portal("right", 2, "top", 1);
Portal("back", 0, "bottom", 0);
Portal("back", 1, "left", 3);
Portal("back", 2, "top", 2);
Portal("left", 0, "bottom", 3);
Portal("left", 2, "top", 3);

startingHouse("front", {
  position: [-3.0, 0, 0.6],
  scale: 1,
  turn: 12,
});

startingQuestionCube("front", {
  position: [-2.45, 0.05, 3.25],
  scale: 1,
  turn: -18,
  goalPages: [
    {
    title: "Goal",
    body: "Explore the world. Use landmarks and floor textures to tell the regions apart.\n\n You can use the tool menu to place signs to help you keep track of places you have visited.",
  },
{
    title: "Questions",
    body: "Answer these questions:\n\n How much space is there? Is this a finite or infinite world? \n\n Does this world look like ours or are there points where something different happens?",
  }
],
});

startingPosition("front", {
  position: [-3.769270715138527, 0, 4.219146347597855],
  turn: 225,
});

front_mouse = geo_mouse("front-runner", {
  position: [-4.2, 0, -1.8],
  turn: 74,
  speed: 2.4,
  oscillationRate: 1.6,
  oscillationMagnitude: 0.18,
});

right_tree = tree("right-tree", {
  position: [0.8, 0, -0.5],
  turn: -20,
});

back_butterfly = geo_butterfly("back-butterfly", {
  position: [0.4, 1.5, 0.9],
  turn: 66,
  speed: 0.8,
  oscillationRate: 1.2,
  oscillationMagnitude: 0.3,
});

left_bench = bench("left-bench", {
  position: [-0.9, 0, 0.7],
  scale: 0.9,
  turn: 46,
});

top_grass = grass("top-grass", {
  position: [0.2, 0, -0.2],
  scale: 1.2,
  turn: -9,
});

bottom_bicycle = bicycle("bottom-bicycle", {
  position: [-0.5, 0, -0.8],
  scale: 0.85,
  turn: 29,
});

OnFace("front", [front_mouse]);
OnFace("right", [right_tree]);
OnFace("back", [back_butterfly]);
OnFace("left", [left_bench]);
OnFace("top", [top_grass]);
OnFace("bottom", [bottom_bicycle]);
