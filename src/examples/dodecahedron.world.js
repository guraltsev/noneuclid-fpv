pentagon = [
  [0, -8],
  [7.608452130361228, -2.4721359549995796],
  [4.702282018339785, 6.47213595499958],
  [-4.702282018339784, 6.47213595499958],
  [-7.608452130361229, -2.4721359549995787],
];

grass_floor = floorTexture("grass1");
leaves_floor = floorTexture("forest_leaves");
pebble_floor = floorTexture("river_pebbles");
sand_floor = floorTexture("gravelly_sand");
mud_floor = floorTexture("red_mud_stones");
snow_floor = floorTexture("snow");

PolygonFace("top", grass_floor, pentagon);
PolygonFace("upper-0", leaves_floor, pentagon);
PolygonFace("upper-1", pebble_floor, pentagon);
PolygonFace("upper-2", sand_floor, pentagon);
PolygonFace("upper-3", mud_floor, pentagon);
PolygonFace("upper-4", snow_floor, pentagon);
PolygonFace("lower-0", grass_floor, pentagon);
PolygonFace("lower-1", leaves_floor, pentagon);
PolygonFace("lower-2", pebble_floor, pentagon);
PolygonFace("lower-3", sand_floor, pentagon);
PolygonFace("lower-4", mud_floor, pentagon);
PolygonFace("bottom", snow_floor, pentagon);

// Each pentagon side i runs from vertex i to vertex i + 1, and a portal reverses the side, so
// Portal(A, i, B, j) identifies corner (A, i) with (B, j + 1). This pairing gives 20 vertex classes of three
// 108-degree corners each (V - E + F = 20 - 30 + 12 = 2): the dodecahedron.
for (let k = 0; k < 5; k += 1) {
  const next = (k + 1) % 5;
  Portal("top", k, "upper-" + k, 0);
  Portal("upper-" + k, 4, "upper-" + next, 1);
  Portal("upper-" + k, 2, "lower-" + k, 0);
  Portal("upper-" + k, 3, "lower-" + next, 1);
  Portal("lower-" + k, 4, "lower-" + next, 2);
  Portal("bottom", (5 - k) % 5, "lower-" + k, 3);
}

startingHouse("top", {
  position: [-3.0, 0, 0.6],
  scale: 1,
  turn: 12,
});

startingQuestionCube("top", {
  position: [-2.45, 0.05, 3.25],
  scale: 1,
  turn: -18,
  goalPages: [{
    title: "Goal",
    body: "Explore the dodecahedron's twelve pentagonal faces. Use objects and textures to build a mental map.",
  }],
});

top_mouse = geo_mouse("top-geo-mouse", {
  position: [-3.2, 0, -1.7],
  turn: 67,
  speed: 1.9,
  oscillationRate: 1.4,
  oscillationMagnitude: 0.16,
});

upper_0_flower_pot = flower_pot("upper-0-flower-pot", {
  position: [-1.6, 0, 0.8],
  scale: 0.9,
  turn: 20,
});

upper_1_tree = tree("upper-1-tree", {
  position: [0.6, 0, 0.4],
  turn: -23,
});

upper_2_butterfly = geo_butterfly("upper-2-butterfly", {
  position: [0.2, 1.5, -0.7],
  turn: 40,
  speed: 0.8,
  oscillationRate: 1.5,
  oscillationMagnitude: 0.28,
});

upper_3_grass = grass("upper-3-grass", {
  position: [0.3, 0, 0.1],
  scale: 1.1,
  turn: 29,
});

upper_4_tree_swirl = tree_swirl("upper-4-tree-swirl", {
  position: [-0.5, 0, -0.5],
  scale: 1,
  turn: -14,
});

lower_0_flower_group = flower_group("lower-0-flower-group", {
  position: [-0.4, 0, 0.9],
  scale: 1,
  turn: -18,
});

lower_1_traffic_cone = traffic_cone("lower-1-traffic-cone", {
  position: [0.6, 0, -0.6],
  scale: 0.9,
  turn: 10,
});

lower_2_bench = bench("lower-2-bench", {
  position: [0.2, 0, 0.4],
  scale: 0.85,
  turn: 72,
});

lower_3_bicycle = bicycle("lower-3-bicycle", {
  position: [-0.7, 0, -0.2],
  scale: 0.8,
  turn: -36,
});

bottom_stop_sign = stop_sign("bottom-stop-sign", {
  position: [0, 0, 0],
  scale: 0.85,
  turn: 12,
});

OnFace("top", [top_mouse]);
OnFace("upper-0", [upper_0_flower_pot]);
OnFace("upper-1", [upper_1_tree]);
OnFace("upper-2", [upper_2_butterfly]);
OnFace("upper-3", [upper_3_grass]);
OnFace("upper-4", [upper_4_tree_swirl]);
OnFace("lower-0", [lower_0_flower_group]);
OnFace("lower-1", [lower_1_traffic_cone]);
OnFace("lower-2", [lower_2_bench]);
OnFace("lower-3", [lower_3_bicycle]);
OnFace("bottom", [bottom_stop_sign]);
