square = [
  [-7.5, -7.5],
  [7.5, -7.5],
  [7.5, 7.5],
  [-7.5, 7.5],
];

PolygonFace("torus-room", floorTexture("river_pebbles"), square);

Portal("torus-room", 0, "torus-room", 2);
Portal("torus-room", 1, "torus-room", 3);

startingHouse("torus-room", {
  position: [-3.0, 0, 0.6],
  scale: 1,
  turn: 12,
});

startingQuestionCube("torus-room", {
  position: [0.46, 0.05, 1.7],
  scale: 1,
  turn: -18,
  goalPages: [{
    title: "Goal",
    body: "Cross opposite edges in the flat torus room and watch how the room wraps around.",
  }],
});

torus_mouse = geo_mouse("torus-geo-mouse", {
  position: [-4.4, 0, 1.1],
  turn: 70,
  speed: 2.7,
  oscillationRate: 1.7,
  oscillationMagnitude: 0.18,
});

torus_bench = bench("torus-bench", {
  position: [3.1, 0, -2.4],
  scale: 0.9,
  turn: -35,
});

torus_traffic_cone = traffic_cone("torus-traffic-cone", {
  position: [-2.7, 0, -2.8],
  scale: 0.85,
  turn: 12,
});

torus_flower_group = flower_group("torus-flower-group", {
  position: [2.6, 0, 2.6],
  scale: 0.9,
  turn: 28,
});

OnFace("torus-room", [
  torus_mouse,
  torus_bench,
  torus_traffic_cone,
  torus_flower_group,
]);

// The first view (design 017 section 9): the help cube and the tool stand ahead, the demonstration beside them, open space behind.
toolStand("torus-room", {
  position: [-0.58, 0, 2.67],
  facing: -14,
});

demo("torus-room", {
  laser: { position: [1.44, 0, 1.92], yawDegrees: 200, beamLength: 12 },
  ruler: true,
  sign: { position: [-0.4, 0, 0.8], text: "Start" },
});

startingPosition("torus-room", {
  position: [0, 0, 5],
  faceToward: "startingQuestionCube",
});

// Discoveries (design 017 section 9.4): the world is one face, so there is no way back to the starting face by another edge, and no shape machine.
discoveries({ disable: ["back-where-you-started", "new-shape"] });
