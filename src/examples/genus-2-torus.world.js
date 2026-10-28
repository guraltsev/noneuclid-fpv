octagon_scale = 8.0;

octagon = [
  [8.31491579260158 * octagon_scale, -3.444150891285808 * octagon_scale],
  [8.31491579260158 * octagon_scale, 3.444150891285808 * octagon_scale],
  [3.444150891285808 * octagon_scale, 8.31491579260158 * octagon_scale],
  [-3.444150891285808 * octagon_scale, 8.31491579260158 * octagon_scale],
  [-8.31491579260158 * octagon_scale, 3.444150891285808 * octagon_scale],
  [-8.31491579260158 * octagon_scale, -3.444150891285808 * octagon_scale],
  [-3.444150891285808 * octagon_scale, -8.31491579260158 * octagon_scale],
  [3.444150891285808 * octagon_scale, -8.31491579260158 * octagon_scale],
];

PolygonFace("genus-2-octagon", floorTexture("paving_stones"), octagon);

Portal("genus-2-octagon", 0, "genus-2-octagon", 2);
Portal("genus-2-octagon", 1, "genus-2-octagon", 3);
Portal("genus-2-octagon", 4, "genus-2-octagon", 6);
Portal("genus-2-octagon", 5, "genus-2-octagon", 7);

startingHouse("genus-2-octagon", {
  position: [-3.0, 0, 0.6],
  scale: 1,
  turn: 12,
});

startingQuestionCube("genus-2-octagon", {
  position: [-2.45, 0.05, 3.25],
  scale: 1,
  turn: -18,
  goalPages: [{
    title: "Goal",
    body: "Explore the regular octagon model of a genus-2 torus. Each paired portal wraps one side of the two-handled surface.",
  }],
});

genus_2_mouse = geo_mouse("genus-2-geo-mouse", {
  position: [-4.8, 0, -1.4],
  turn: 58,
  speed: 2.4,
  oscillationRate: 1.5,
  oscillationMagnitude: 0.18,
});

genus_2_side_0_stop_sign = stop_sign("genus-2-side-0-stop-sign", {
  position: [51.85, 0, 0],
  scale: 1,
  turn: -90,
});

genus_2_side_1_tree = tree("genus-2-side-1-tree", {
  position: [36.95, 0, 36.95],
  scale: 0.85,
  turn: 25,
});

genus_2_side_2_bicycle = bicycle("genus-2-side-2-bicycle", {
  position: [0, 0, 51.85],
  scale: 0.85,
  turn: 90,
});

genus_2_side_3_flower_pot = flower_pot("genus-2-side-3-flower-pot", {
  position: [-36.95, 0, 36.95],
  scale: 1.25,
  turn: -24,
});

genus_2_side_4_campfire = campfire("genus-2-side-4-campfire", {
  position: [-51.85, 0, 0],
  scale: 0.75,
  turn: 0,
});

genus_2_side_5_rocks = rocks("genus-2-side-5-rocks", {
  position: [-36.95, 0, -36.95],
  scale: 0.85,
  turn: 32,
});

genus_2_side_6_marker = traffic_cone("genus-2-side-6-traffic-cone", {
  position: [0, 0, -51.85],
  scale: 0.85,
  turn: 0,
});

genus_2_side_7_bench = bench("genus-2-side-7-bench", {
  position: [36.95, 0, -36.95],
  scale: 0.85,
  turn: -28,
});

genus_2_flower_group = flower_group("genus-2-flower-group", {
  position: [-1.0, 0, -4.0],
  scale: 0.9,
  turn: 18,
});

OnFace("genus-2-octagon", [
  genus_2_mouse,
  genus_2_side_0_stop_sign,
  genus_2_side_1_tree,
  genus_2_side_2_bicycle,
  genus_2_side_3_flower_pot,
  genus_2_side_4_campfire,
  genus_2_side_5_rocks,
  genus_2_side_6_marker,
  genus_2_side_7_bench,
  genus_2_flower_group,
]);
