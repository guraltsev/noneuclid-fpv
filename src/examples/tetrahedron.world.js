triangle = [
  [0, -13.333333333333334],
  [11.547005383792516, 6.666666666666667],
  [-11.547005383792516, 6.666666666666667],
];

grass_floor = floorTexture("grass1");
leaves_floor = floorTexture("forest_leaves");
pebble_floor = floorTexture("river_pebbles");
sand_floor = floorTexture("gravelly_sand");

PolygonFace("face-a", grass_floor, triangle);
PolygonFace("face-b", leaves_floor, triangle);
PolygonFace("face-c", pebble_floor, triangle);
PolygonFace("face-d", sand_floor, triangle);

Portal("face-a", 0, "face-d", 1);
Portal("face-a", 1, "face-b", 1);
Portal("face-a", 2, "face-c", 1);
Portal("face-b", 0, "face-c", 2);
Portal("face-b", 2, "face-d", 0);
Portal("face-c", 0, "face-d", 2);

startingHouse("face-a", {
  position: [-3.0, 0, 0.6],
  scale: 1,
  turn: 12,
});

startingQuestionCube("face-a", {
  position: [-2.45, 0.05, 3.25],
  scale: 1,
  turn: -18,
  goalPages: [{
    title: "Goal",
    body: "Explore the tetrahedron's four triangular faces and notice how every face connects to the other three.",
  }],
});

face_a_mouse = geo_mouse("face-a-geo-mouse", {
  position: [-2.2, 0, 2.2],
  turn: 114,
  speed: 1.7,
  oscillationRate: 1.4,
  oscillationMagnitude: 0.15,
  collision: {
    radius: 0.42,
    height: 0.6,
    offset: { x: 0, y: 0.75, z: 0.31 },
  },
});

face_b_butterfly = geo_butterfly("face-b-centerpiece", {
  position: [0, 1.5, 0],
  turn: 20,
  speed: 0.7,
  oscillationRate: 1.3,
  oscillationMagnitude: 0.25,
});

face_c_tree = tree("face-c-centerpiece", {
  position: [0, 0, 0],
});

face_c_flower_pot = flower_pot("face-c-flower-pot", {
  position: [3.1, 0, 1.4],
  scale: 0.85,
  turn: 18,
});

face_d_grass = grass("face-d-centerpiece", {
  position: [0, 0, 0],
  scale: 1.2,
});

face_d_stop_sign = stop_sign("face-d-stop-sign", {
  position: [-3.2, 0, 1.8],
  scale: 0.8,
  turn: -25,
});

OnFace("face-a", [face_a_mouse]);
OnFace("face-b", [face_b_butterfly]);
OnFace("face-c", [face_c_tree, face_c_flower_pot]);
OnFace("face-d", [face_d_grass, face_d_stop_sign]);
