// Pre-loaded routine parsed from 4-Day_Machine_lifting_routine.xlsx + Sunday DB Arms & Shoulders
const DEFAULT_ROUTINE = [
  {
    "id": "wed___upper_a",
    "title": "Wed - Upper A",
    "tag": "Upper",
    "exercises": [
      {
        "id": "wed___upper_a_ex1",
        "name": "Converging Machine Chest Press",
        "muscle": "Chest",
        "sets": 3,
        "targetReps": "6–8",
        "startingWeight": "100–120 lbs",
        "rest": "3 min",
        "notes": "Seat height so handles align with mid-chest; elbows at 45–60°; 2–3s negative.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+machine+chest+press+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "wed___upper_a_ex2",
        "name": "Neutral-Grip Lat Pulldown",
        "muscle": "Back / Lats",
        "sets": 3,
        "targetReps": "8–10",
        "startingWeight": "110–130 lbs",
        "rest": "2 min",
        "notes": "Clamp thigh pads down tightly to brace your frame; let lats stretch fully at the top.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+lat+pulldown+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "wed___upper_a_ex3",
        "name": "Chest-Supported Machine Row",
        "muscle": "Back / Lats",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "90–110 lbs",
        "rest": "2 min",
        "notes": "Adjust chest pad forward so arms fully extend; flare elbows 45–60° for upper back and rear delts.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+chest+supported+row+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "wed___upper_a_ex4",
        "name": "Cable Lateral Raise",
        "muscle": "Shoulders",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "10–15 lbs",
        "rest": "2 min",
        "notes": "Set pulley to wrist height; stand slightly sideways; lead with your elbows to isolate side delts.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+cable+lateral+raise",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "wed___upper_a_ex5",
        "name": "Triceps Rope Pushdown",
        "muscle": "Triceps",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "40–50 lbs",
        "rest": "2 min",
        "notes": "Lock elbows against ribs; spread rope apart firmly at bottom contraction.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+tricep+pushdown+technique",
        "isOptional": false,
        "superset": {
          "id": "upper_a_arms",
          "tag": "5A",
          "name": "Arm Finisher Superset (Triceps + Biceps)",
          "tip": "⚡ Superset: Perform 1 set of Triceps, rest 45–60s, then perform 1 set of Biceps, rest 60s. Saves ~6 mins!",
          "rest": "45–60 sec"
        }
      },
      {
        "id": "wed___upper_a_ex6",
        "name": "Cable Biceps Curl",
        "muscle": "Biceps",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "40–50 lbs",
        "rest": "2 min",
        "notes": "Straight bar or EZ-attachment; elbows held slightly forward of hips; full extension at bottom.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+cable+bicep+curl",
        "isOptional": false,
        "superset": {
          "id": "upper_a_arms",
          "tag": "5B",
          "name": "Arm Finisher Superset (Triceps + Biceps)",
          "tip": "⚡ Superset: Alternate with Triceps Rope Pushdown. Saves ~6 mins!",
          "rest": "60 sec"
        }
      },
      {
        "id": "wed___upper_a_opt_facepull",
        "name": "Cable Face Pull (Rear Delts & Posture)",
        "muscle": "Shoulders",
        "sets": 2,
        "targetReps": "10–12",
        "startingWeight": "30–40 lbs",
        "rest": "90 sec",
        "notes": "Set pulley to eye level; thumbs back; pull rope toward forehead while pulling elbows back to build healthy shoulders.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+face+pull+technique",
        "isOptional": true,
        "superset": null
      }
    ]
  },
  {
    "id": "fri___lower_a",
    "title": "Fri - Lower A",
    "tag": "Lower",
    "exercises": [
      {
        "id": "fri___lower_a_ex1",
        "name": "Hack Squat (or 45° Leg Press)",
        "muscle": "Quads",
        "sets": 3,
        "targetReps": "6–8",
        "startingWeight": "140 lbs",
        "rest": "3 min",
        "notes": "Feet mid-to-low and shoulder-width; descend to deep knee bend; keep lower back/glutes glued to pad.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+hack+squat+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "fri___lower_a_ex2",
        "name": "Leg Extension",
        "muscle": "Quads",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "80–100 lbs",
        "rest": "2 min",
        "notes": "Slide backrest fully back to align knee joint with machine pivot; hold 1s squeeze at top.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+leg+extension+technique",
        "isOptional": false,
        "superset": {
          "id": "lower_a_quad_ham",
          "tag": "2A",
          "name": "Antagonist Superset (Quads + Hamstrings)",
          "tip": "⚡ Superset: Perform 1 set of Leg Extensions, rest 60s, then perform 1 set of Seated Leg Curls, rest 60s. Saves ~8 mins!",
          "rest": "60 sec"
        }
      },
      {
        "id": "fri___lower_a_ex3",
        "name": "Seated Leg Curl",
        "muscle": "Hamstrings / Glutes",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "80–100 lbs",
        "rest": "2 min",
        "notes": "Clamp thigh pad down firmly; lean torso slightly forward; slow 3s eccentric stretch.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+seated+leg+curl",
        "isOptional": false,
        "superset": {
          "id": "lower_a_quad_ham",
          "tag": "2B",
          "name": "Antagonist Superset (Quads + Hamstrings)",
          "tip": "⚡ Superset: Alternate with Leg Extensions. Quads rest while hamstrings work!",
          "rest": "60–75 sec"
        }
      },
      {
        "id": "fri___lower_a_ex4",
        "name": "Standing / Leg Press Calf Raise",
        "muscle": "Calves",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "120–150 lbs",
        "rest": "2 min",
        "notes": "Full 2-second dead pause at bottom stretch to eliminate Achilles elastic rebound.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+calf+raise+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "fri___lower_a_ex5",
        "name": "Kneeling Cable Crunch",
        "muscle": "Abs / Core",
        "sets": 3,
        "targetReps": "10–12",
        "startingWeight": "60–80 lbs",
        "rest": "90 sec",
        "notes": "Anchor hips in place; actively round ribcage down into your pelvis like rolling up a mat.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+cable+crunch+technique",
        "isOptional": true,
        "superset": null
      }
    ]
  },
  {
    "id": "sat___upper_b",
    "title": "Sat - Upper B",
    "tag": "Upper",
    "exercises": [
      {
        "id": "sat___upper_b_ex1",
        "name": "Smith Machine Incline Press (30°)",
        "muscle": "Chest",
        "sets": 3,
        "targetReps": "6–8",
        "startingWeight": "Bar + 50–70 lbs",
        "rest": "3 min",
        "notes": "Bench at ~30°; bar lowers directly to clavicle/upper chest; tuck elbows 45°; 2–3s descent.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+smith+machine+incline+press",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "sat___upper_b_ex2",
        "name": "Half-Kneeling Single-Arm Pulldown",
        "muscle": "Back / Lats",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "40–55 lbs",
        "rest": "2 min",
        "notes": "Set pulley high; kneel on mat; drive elbow straight down to hip pocket for pure lat focus.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+single+arm+lat+pulldown",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "sat___upper_b_ex3",
        "name": "Machine Overhead Shoulder Press",
        "muscle": "Shoulders",
        "sets": 3,
        "targetReps": "6–8",
        "startingWeight": "70–90 lbs",
        "rest": "3 min",
        "notes": "Set seat low so handles start level with ears; drive straight up without hyper-arching lower back.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+shoulder+press+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "sat___upper_b_ex_cable_row",
        "name": "Neutral-Grip Seated Cable Row",
        "muscle": "Back / Lats",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "90–120 lbs",
        "rest": "2 min",
        "notes": "Sit tall with chest proud; pull attachment into navel; pause 1s at contraction; slow stretch.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+seated+cable+row+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "sat___upper_b_ex4",
        "name": "Machine Pec Deck Flye",
        "muscle": "Chest",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "70–90 lbs",
        "rest": "2 min",
        "notes": "Soft bend in elbows; squeeze chest together without shrugging shoulders forward; deep stretch.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+chest+flye+pec+deck",
        "isOptional": false,
        "superset": null
      }
    ]
  },
  {
    "id": "sun___db_arms",
    "title": "Sun - DB Arms & Shoulders",
    "tag": "Arms / Shoulders",
    "exercises": [
      {
        "id": "sun___db_arms_ex2",
        "name": "Standing Dumbbell Lateral Raise",
        "muscle": "Shoulders",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "15–20 lbs DBs",
        "rest": "2 min",
        "notes": "Stand with slight forward torso hinge; raise dumbbells out leading with your elbows; control the 2-second negative. Zero bench needed!",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+lateral+raise",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "sun___db_arms_ex5",
        "name": "Standing Bent-Over DB Rear Delt Flye",
        "muscle": "Shoulders",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "15–20 lbs DBs",
        "rest": "90 sec",
        "notes": "Hinge at the hips with soft knees and a flat back; sweep dumbbells out wide leading with pinkies to isolate rear delts. Zero bench needed!",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+rear+delt+flye",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "sun___db_arms_ex3",
        "name": "Standing Dumbbell Biceps / Hammer Curl",
        "muscle": "Biceps",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "20–30 lbs DBs",
        "rest": "2 min",
        "notes": "Stand tall with chest up; keep elbows pinned slightly forward of hips; curl with controlled supination (or hammer grip) and squeeze at the top; 2–3s negative. Zero bench needed!",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+bicep+curl",
        "isOptional": false,
        "superset": {
          "id": "sun_db_arm_superset",
          "tag": "2A",
          "name": "Dumbbell Arm Superset (Biceps + Triceps)",
          "tip": "⚡ Superset: Perform 1 set of Curls, rest 45–60s, then perform 1 set of Overhead Triceps Extensions, rest 60s. Saves ~7 mins!",
          "rest": "45–60 sec"
        }
      },
      {
        "id": "sun___db_arms_ex4",
        "name": "Standing / Seated DB Overhead Triceps Extension",
        "muscle": "Triceps",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "30–45 lbs DB",
        "rest": "2 min",
        "notes": "Cup one dumbbell with both hands overhead (standing or seated in a regular chair); lower behind head for full triceps stretch; flare elbows only slightly. Zero bench needed!",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+overhead+tricep+extension",
        "isOptional": false,
        "superset": {
          "id": "sun_db_arm_superset",
          "tag": "2B",
          "name": "Dumbbell Arm Superset (Biceps + Triceps)",
          "tip": "⚡ Superset: Alternate with Standing Biceps Curls. Fits your 30-min window at home!",
          "rest": "60 sec"
        }
      }
    ]
  },
  {
    "id": "mon__lower_b",
    "title": "Mon - Lower B",
    "tag": "Lower",
    "exercises": [
      {
        "id": "mon__lower_b_ex_hip_thrust",
        "name": "Machine Hip Thrust / Glute Drive",
        "muscle": "Glutes",
        "sets": 3,
        "targetReps": "6–8",
        "startingWeight": "Light (find weight)",
        "rest": "3 min",
        "notes": "Position the belt/pad across the hips, brace, and raise the hips without arching the lower back. Lower under control. Effort: finish with 2–3 reps in reserve.",
        "videoUrl": "https://www.youtube.com/results?search_query=machine+hip+thrust+glute+drive+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "mon__lower_b_ex2",
        "name": "Horizontal Leg Press",
        "muscle": "Quads",
        "sets": 3,
        "targetReps": "6–8",
        "startingWeight": "180–230 lbs",
        "rest": "3 min",
        "notes": "Feet placed high on platform; bring knees deep toward chest to load glutes and hamstrings.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+leg+press+technique",
        "isOptional": false,
        "superset": {
          "id": "lower_b_leg_press_calf",
          "tag": "2A",
          "name": "Same-Machine Superset (Quads + Calves)",
          "tip": "⚡ Superset: Perform 1 set of Leg Press, rest 45–60s (adjust weight pin & slide feet to bottom edge), then perform Calf Press, rest 60s. Saves ~6 mins!",
          "rest": "45–60 sec"
        }
      },
      {
        "id": "mon__lower_b_ex5",
        "name": "Leg Press Calf Press",
        "muscle": "Calves",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "140–180 lbs",
        "rest": "2 min",
        "notes": "Balls of feet on lower edge; achieve full ankle flexion stretch with a 2-second dead stop.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+calf+press+leg+press",
        "isOptional": false,
        "superset": {
          "id": "lower_b_leg_press_calf",
          "tag": "2B",
          "name": "Same-Machine Superset (Quads + Calves)",
          "tip": "⚡ Superset: Alternate with Horizontal Leg Press on the same machine. Calves work while quads rest!",
          "rest": "60 sec"
        }
      },
      {
        "id": "mon__lower_b_ex3",
        "name": "Lying Leg Curl",
        "muscle": "Hamstrings / Glutes",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "70–90 lbs",
        "rest": "2 min",
        "notes": "Keep hips pinned flat into the pad; avoid hyperextending lower back; control the negative.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+lying+leg+curl",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "mon__lower_b_ex_back_ext",
        "name": "45-Degree Back Extension",
        "muscle": "Glutes / Hamstrings",
        "sets": 3,
        "targetReps": "8–12",
        "startingWeight": "Bodyweight",
        "rest": "2 min",
        "notes": "Pad just below the hip crease, feet secured, hinge slowly at the hips while keeping the spine comfortably steady. Rise until torso and legs align; don’t swing or arch backward. Effort: finish with 3–4 clean reps in reserve.",
        "videoUrl": "https://www.youtube.com/results?search_query=45+degree+back+extension+for+glutes+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "mon__lower_b_ex6",
        "name": "Captain's Chair Knee Raise",
        "muscle": "Abs / Core",
        "sets": 3,
        "targetReps": "10–12",
        "startingWeight": "Bodyweight",
        "rest": "90 sec",
        "notes": "Forearms locked on pads; pull knees up while actively rolling pelvis toward your chest.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+hanging+knee+raise+technique",
        "isOptional": true,
        "superset": null
      }
    ]
  }
];

// Biomechanically equivalent substitutions for machine availability & variety
const EXERCISE_SUBSTITUTIONS = {
  "Converging Machine Chest Press": [
    { name: "Incline Dumbbell Bench Press", type: "Dumbbell", muscle: "Chest", targetReps: "8–10", notes: "Set bench to 30°; lower dumbbells under control; press up and slightly inward.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+incline+dumbbell+press" },
    { name: "Flat Dumbbell Bench Press", type: "Dumbbell", muscle: "Chest", targetReps: "8–10", notes: "Tuck elbows 45–60°; arch upper back; squeeze chest at top.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+bench+press" },
    { name: "Pec Fly Machine", type: "Machine", muscle: "Chest", targetReps: "10–12", notes: "Seat height so handles line up with mid-chest; feel full horizontal adduction stretch.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+pec+deck+fly" },
    { name: "Smith Machine Chest Press", type: "Machine", muscle: "Chest", targetReps: "8–10", notes: "Bar tracks directly to mid-chest; full control on 2–3s negative.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+smith+machine+bench+press" }
  ],
  "Neutral-Grip Lat Pulldown": [
    { name: "Wide-Grip Lat Pulldown", type: "Cable", muscle: "Back / Lats", targetReps: "8–10", notes: "Grip just outside shoulder width; lean back 10–15°; pull bar to upper clavicle.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+wide+grip+lat+pulldown" },
    { name: "Chest-Supported Machine Row", type: "Machine", muscle: "Back / Lats", targetReps: "8–12", notes: "Chest flat against pad; pull elbows tight to ribs for lats.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+chest+supported+row" },
    { name: "One-Arm Dumbbell Row", type: "Dumbbell", muscle: "Back / Lats", targetReps: "8–10", notes: "Brace on bench; pull dumbbell toward hip pocket; full stretch at bottom.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+one+arm+dumbbell+row" },
    { name: "Dumbbell Pullover", type: "Dumbbell", muscle: "Back / Lats", targetReps: "10–12", notes: "Lie across bench; lower DB overhead feeling full lat extension.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+pullover" }
  ],
  "Chest-Supported Machine Row": [
    { name: "Neutral-Grip Seated Cable Row", type: "Cable", muscle: "Back / Lats", targetReps: "8–12", notes: "Sit tall with chest proud; pull attachment into navel; pause 1s.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+seated+cable+row" },
    { name: "Chest-Supported Dumbbell Row", type: "Dumbbell", muscle: "Back / Lats", targetReps: "8–12", notes: "Lie chest down on 30–45° incline bench; pull DBs up to ribcage.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+chest+supported+dumbbell+row" },
    { name: "T-Bar Row Machine", type: "Machine", muscle: "Back / Lats", targetReps: "8–10", notes: "Chest flat against pad; neutral grip; focus on squeezing shoulder blades.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+t+bar+row" }
  ],
  "Cable Lateral Raise": [
    { name: "Standing Dumbbell Lateral Raise", type: "Dumbbell", muscle: "Shoulders", targetReps: "10–15", notes: "Slight forward torso lean; raise DBs in scapular plane (30° forward).", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+lateral+raise" },
    { name: "Machine Lateral Raise", type: "Machine", muscle: "Shoulders", targetReps: "10–15", notes: "Seat adjusted so pivot axis aligns with shoulder joints; lead with elbows.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+machine+lateral+raise" },
    { name: "Incline Leaning Cable Lateral Raise", type: "Cable", muscle: "Shoulders", targetReps: "10–12", notes: "Pulley at knee height; lean away from cable tower for continuous tension.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+cable+lateral+raise" }
  ],
  "Triceps Rope Pushdown": [
    { name: "Straight Bar Cable Pushdown", type: "Cable", muscle: "Triceps", targetReps: "8–12", notes: "Overhand grip; lock elbows at sides; full lockout at bottom.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+straight+bar+pushdown" },
    { name: "Overhead Cable Triceps Extension", type: "Cable", muscle: "Triceps", targetReps: "10–12", notes: "Face away from high/low pulley; extend arms overhead for long head tricep stretch.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+overhead+cable+tricep+extension" },
    { name: "Standing Overhead DB Triceps Extension", type: "Dumbbell", muscle: "Triceps", targetReps: "10–12", notes: "Cup DB with both hands overhead; keep elbows pointing upward.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+overhead+dumbbell+tricep+extension" }
  ],
  "Cable Biceps Curl": [
    { name: "Standing Alternating DB Curl", type: "Dumbbell", muscle: "Biceps", targetReps: "8–12", notes: "Supinate wrists as you curl up; squeeze biceps hard at the peak.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+bicep+curl" },
    { name: "Incline Dumbbell Curl", type: "Dumbbell", muscle: "Biceps", targetReps: "8–12", notes: "Bench at 45–60°; arms hang vertical; intense stretch on long head.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+incline+dumbbell+curl" },
    { name: "Preacher Curl Machine", type: "Machine", muscle: "Biceps", targetReps: "8–12", notes: "Armpits over pad; eliminate momentum; smooth controlled contraction.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+preacher+curl" }
  ],
  "Seated Leg Curl": [
    { name: "Lying Leg Curl", type: "Machine", muscle: "Hamstrings", targetReps: "8–12", notes: "Hips pressed flat into pad; dorsiflex toes; squeeze hamstrings to glutes.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+lying+leg+curl" },
    { name: "Dumbbell Romanian Deadlift (RDL)", type: "Dumbbell", muscle: "Hamstrings", targetReps: "8–10", notes: "Soft knees; hinge hips straight back; feel deep stretch in hamstrings.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+rdl" },
    { name: "Standing Single-Leg Curl", type: "Machine", muscle: "Hamstrings", targetReps: "10–12", notes: "Single leg isolation; curl heel up to glute with steady tempo.", videoUrl: "https://www.youtube.com/results?search_query=single+leg+curl+machine" }
  ],
  "Leg Extension": [
    { name: "Goblet Squat (Heels Elevated)", type: "Dumbbell", muscle: "Quads", targetReps: "10–12", notes: "Elevate heels on 5lb plates; torso upright; knee flexion isolates quads.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+goblet+squat" },
    { name: "Bulgarian Split Squat", type: "Dumbbell", muscle: "Quads", targetReps: "8–10", notes: "Rear foot on bench; stay upright to target front quad.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+bulgarian+split+squat" },
    { name: "Sissy Squat (Machine/Bodyweight)", type: "Bodyweight", muscle: "Quads", targetReps: "10–12", notes: "Lean back maintaining straight hip line; intense rectus femoris stretch.", videoUrl: "https://www.youtube.com/results?search_query=sissy+squat+technique" }
  ],
  "Hack Squat (or Leg Press)": [
    { name: "45° Leg Press", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–12", notes: "Feet shoulder-width on lower platform; depth to 90° knee angle.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+leg+press" },
    { name: "Smith Machine Squat", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–10", notes: "Feet slightly in front of bar; upright torso; deep knee flexion.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+smith+machine+squat" },
    { name: "Dumbbell Goblet Squat", type: "Dumbbell", muscle: "Quads / Glutes", targetReps: "10–12", notes: "Heavy DB held at chest; squat between knees with control.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+goblet+squat" }
  ],
  "Standing Calf Raise": [
    { name: "Seated Calf Raise", type: "Machine", muscle: "Calves", targetReps: "12–15", notes: "Knees bent 90°; targets soleus; 2s pause at bottom stretch.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+seated+calf+raise" },
    { name: "Leg Press Calf Press", type: "Machine", muscle: "Calves", targetReps: "12–15", notes: "Balls of feet on lower edge of sled; full ankle flexion and extension.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+leg+press+calf+raise" },
    { name: "Single-Leg Dumbbell Calf Raise", type: "Dumbbell", muscle: "Calves", targetReps: "12–15", notes: "Hold DB in working hand; stand on step; pause at deep stretch.", videoUrl: "https://www.youtube.com/results?search_query=single+leg+calf+raise" }
  ],
  "Cable Crunch": [
    { name: "Machine Ab Crunch", type: "Machine", muscle: "Abs / Core", targetReps: "10–15", notes: "Seat adjusted; curl ribs toward pelvis; avoid pulling with arms.", videoUrl: "https://www.youtube.com/results?search_query=machine+ab+crunch+technique" },
    { name: "Hanging Knee / Leg Raise", type: "Bodyweight", muscle: "Abs / Core", targetReps: "10–12", notes: "Tuck pelvis upward; focus on curling lower spine.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+hanging+knee+raise" },
    { name: "Decline Bench Sit-Up", type: "Bodyweight", muscle: "Abs / Core", targetReps: "12–15", notes: "Cross arms on chest; round spine as you curl up.", videoUrl: "https://www.youtube.com/results?search_query=decline+sit+up+technique" }
  ],
  "Machine Shoulder Press": [
    { name: "Seated Dumbbell Shoulder Press", type: "Dumbbell", muscle: "Shoulders", targetReps: "8–10", notes: "Bench at 75–80°; press dumbbells overhead without clanking.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+shoulder+press" },
    { name: "Smith Machine Overhead Press", type: "Machine", muscle: "Shoulders", targetReps: "8–10", notes: "Seat adjusted; bar passes just in front of nose; elbows tucked 30°.", videoUrl: "https://www.youtube.com/results?search_query=smith+machine+shoulder+press" },
    { name: "Standing Overhead DB Press", type: "Dumbbell", muscle: "Shoulders", targetReps: "8–10", notes: "Core braced; press overhead with clean vertical bar path.", videoUrl: "https://www.youtube.com/results?search_query=overhead+dumbbell+press" }
  ],
  "Neutral-Grip Seated Cable Row": [
    { name: "Chest-Supported Machine Row", type: "Machine", muscle: "Back / Lats", targetReps: "8–12", notes: "Pad adjusted; elbows tight to sides for lats.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+chest+supported+row" },
    { name: "One-Arm Dumbbell Row", type: "Dumbbell", muscle: "Back / Lats", targetReps: "8–10", notes: "Brace on bench; pull DB to hip pocket; control the stretch.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+one+arm+dumbbell+row" },
    { name: "T-Bar Row Machine", type: "Machine", muscle: "Back / Lats", targetReps: "8–10", notes: "Neutral grip; pull into abdomen.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+t+bar+row" }
  ],
  "Pec Fly Machine": [
    { name: "Standing Cable Crossover / Fly", type: "Cable", muscle: "Chest", targetReps: "10–12", notes: "Pulleys at mid height; hug-a-tree motion; squeeze inner pecs.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+cable+crossover" },
    { name: "Flat Dumbbell Fly", type: "Dumbbell", muscle: "Chest", targetReps: "10–12", notes: "Slight bend in elbows; deep chest stretch at bottom; squeeze up.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+fly" },
    { name: "Incline Cable Fly", type: "Cable", muscle: "Chest", targetReps: "10–12", notes: "Bench at 30°; cables pull from low position up across upper chest.", videoUrl: "https://www.youtube.com/results?search_query=incline+cable+fly" }
  ],
  "Lat Pulldown (Wide-Grip)": [
    { name: "Neutral-Grip Lat Pulldown", type: "Cable", muscle: "Back / Lats", targetReps: "8–10", notes: "Close parallel grip; pull to upper chest; intense lat stretch.", videoUrl: "https://www.youtube.com/results?search_query=neutral+grip+lat+pulldown" },
    { name: "Single-Arm Cable Lat Pulldown", type: "Cable", muscle: "Back / Lats", targetReps: "10–12", notes: "Kneeling at cable; unilateral focus for lat mind-muscle connection.", videoUrl: "https://www.youtube.com/results?search_query=single+arm+cable+pulldown" },
    { name: "Straight-Arm Cable Lat Pushdown", type: "Cable", muscle: "Back / Lats", targetReps: "10–15", notes: "Hips hinged; sweep bar down in arc to thighs.", videoUrl: "https://www.youtube.com/results?search_query=straight+arm+lat+pulldown" }
  ],
  "Incline Overhead Cable Triceps Extension": [
    { name: "Triceps Rope Pushdown", type: "Cable", muscle: "Triceps", targetReps: "8–12", notes: "Lock elbows at ribs; spread rope at bottom.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+tricep+pushdown" },
    { name: "Standing Overhead DB Triceps Extension", type: "Dumbbell", muscle: "Triceps", targetReps: "10–12", notes: "Both hands cup DB overhead; deep elbow flexion.", videoUrl: "https://www.youtube.com/results?search_query=overhead+dumbbell+tricep+extension" },
    { name: "Skull Crushers (Dumbbell or EZ-Bar)", type: "Free Weight", muscle: "Triceps", targetReps: "8–12", notes: "Lie flat; lower weight towards forehead; extend back up.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+skull+crushers" }
  ],
  "Cable Bayian / Behind-the-Back Curl": [
    { name: "Incline Dumbbell Curl", type: "Dumbbell", muscle: "Biceps", targetReps: "8–12", notes: "Bench at 45–60°; arms hang vertical behind torso.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+incline+dumbbell+curl" },
    { name: "Cable Biceps Curl", type: "Cable", muscle: "Biceps", targetReps: "8–12", notes: "Facing low pulley; elbows locked slightly forward.", videoUrl: "https://www.youtube.com/results?search_query=cable+bicep+curl" },
    { name: "Standing Alternating DB Curl", type: "Dumbbell", muscle: "Biceps", targetReps: "8–12", notes: "Supinate at top of contraction.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+bicep+curl" }
  ],
  "Lying Leg Curl": [
    { name: "Seated Leg Curl", type: "Machine", muscle: "Hamstrings", targetReps: "8–12", notes: "Thigh pad firmly locked; dorsiflex feet; curl heels under.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+seated+leg+curl" },
    { name: "Dumbbell Romanian Deadlift (RDL)", type: "Dumbbell", muscle: "Hamstrings", targetReps: "8–10", notes: "Push hips back; keep back flat; feel hamstring tension.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+rdl" },
    { name: "Swiss Ball / Slider Leg Curl", type: "Bodyweight", muscle: "Hamstrings", targetReps: "10–15", notes: "Bridge hips and curl heels toward glutes.", videoUrl: "https://www.youtube.com/results?search_query=swiss+ball+leg+curl" }
  ],
  "Leg Press": [
    { name: "Hack Squat", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–12", notes: "Shoulders snug against pads; descent to parallel.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+hack+squat" },
    { name: "Smith Machine Squat", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–10", notes: "Bar on upper traps; feet slightly forward; deep squat.", videoUrl: "https://www.youtube.com/results?search_query=smith+machine+squat" },
    { name: "Dumbbell Goblet Squat", type: "Dumbbell", muscle: "Quads / Glutes", targetReps: "10–12", notes: "Hold heavy dumbbell at chest; controlled reps.", videoUrl: "https://www.youtube.com/results?search_query=dumbbell+goblet+squat" }
  ],
  "Seated Calf Raise": [
    { name: "Standing Calf Raise", type: "Machine", muscle: "Calves", targetReps: "10–15", notes: "Full range of motion; hold bottom stretch 2 seconds.", videoUrl: "https://www.youtube.com/results?search_query=standing+calf+raise" },
    { name: "Leg Press Calf Press", type: "Machine", muscle: "Calves", targetReps: "12–15", notes: "Balls of feet on bottom edge; deep stretch and peak extension.", videoUrl: "https://www.youtube.com/results?search_query=leg+press+calf+raise" }
  ],
  "Cable Face Pull (Rear Delts & Posture)": [
    { name: "Standing Bent-Over DB Rear Delt Flye", type: "Dumbbell", muscle: "Shoulders", targetReps: "10–12", notes: "Hinge at hips; sweep DBs out leading with pinkies; squeeze rear delts.", videoUrl: "https://www.youtube.com/results?search_query=dumbbell+rear+delt+flye" },
    { name: "Machine Reverse Pec Deck / Rear Delt", type: "Machine", muscle: "Shoulders", targetReps: "10–12", notes: "Chest flat against pad; pull handles back horizontally in line with shoulders.", videoUrl: "https://www.youtube.com/results?search_query=reverse+pec+deck" },
    { name: "Incline Prone DB Row to Chest", type: "Dumbbell", muscle: "Shoulders / Upper Back", targetReps: "10–12", notes: "Chest down on 30° incline; flare elbows 70° pulling to chest line.", videoUrl: "https://www.youtube.com/results?search_query=incline+rear+delt+row" }
  ],
  "Hack Squat (or 45° Leg Press)": [
    { name: "45° Leg Press", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–12", notes: "Feet shoulder-width on lower platform; depth to 90° knee angle.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+leg+press" },
    { name: "Smith Machine Squat", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–10", notes: "Feet slightly in front of bar; upright torso; deep knee flexion.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+smith+machine+squat" },
    { name: "Dumbbell Goblet Squat (Heels Elevated)", type: "Dumbbell", muscle: "Quads / Glutes", targetReps: "10–12", notes: "Heavy DB held at chest; heels on 5lb plates; squat between knees with control.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+goblet+squat" }
  ],
  "Standing / Leg Press Calf Raise": [
    { name: "Seated Calf Raise", type: "Machine", muscle: "Calves", targetReps: "12–15", notes: "Knees bent 90°; targets soleus; 2s pause at bottom stretch.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+seated+calf+raise" },
    { name: "Leg Press Calf Press", type: "Machine", muscle: "Calves", targetReps: "12–15", notes: "Balls of feet on lower edge of sled; full ankle flexion and extension.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+leg+press+calf+raise" },
    { name: "Single-Leg Dumbbell Calf Raise", type: "Dumbbell", muscle: "Calves", targetReps: "12–15", notes: "Hold DB in working hand; stand on step; pause at deep stretch.", videoUrl: "https://www.youtube.com/results?search_query=single+leg+calf+raise" }
  ],
  "Kneeling Cable Crunch": [
    { name: "Machine Ab Crunch", type: "Machine", muscle: "Abs / Core", targetReps: "10–15", notes: "Seat adjusted; curl ribs toward pelvis; avoid pulling with arms.", videoUrl: "https://www.youtube.com/results?search_query=machine+ab+crunch+technique" },
    { name: "Captain's Chair Knee Raise", type: "Bodyweight", muscle: "Abs / Core", targetReps: "10–12", notes: "Forearms braced; tuck pelvis up toward sternum.", videoUrl: "https://www.youtube.com/results?search_query=hanging+knee+raise" },
    { name: "Decline Bench Sit-Up", type: "Bodyweight", muscle: "Abs / Core", targetReps: "12–15", notes: "Cross arms on chest; round spine smoothly as you curl up.", videoUrl: "https://www.youtube.com/results?search_query=decline+sit+up+technique" }
  ],
  "Smith Machine Incline Press (30°)": [
    { name: "Incline Dumbbell Bench Press", type: "Dumbbell", muscle: "Chest", targetReps: "8–10", notes: "Set bench to 30°; lower DBs under control; press up and slightly inward.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+incline+dumbbell+press" },
    { name: "Converging Machine Incline Press", type: "Machine", muscle: "Chest", targetReps: "8–10", notes: "Seat height so handles line up with upper chest; full extension at top.", videoUrl: "https://www.youtube.com/results?search_query=incline+chest+press+machine" },
    { name: "Flat Dumbbell Bench Press", type: "Dumbbell", muscle: "Chest", targetReps: "8–10", notes: "Tuck elbows 45–60°; arch upper back; squeeze chest at top.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+bench+press" }
  ],
  "Half-Kneeling Single-Arm Pulldown": [
    { name: "Neutral-Grip Lat Pulldown", type: "Cable", muscle: "Back / Lats", targetReps: "8–10", notes: "Close grip attachment; pull elbows into sides.", videoUrl: "https://www.youtube.com/results?search_query=neutral+grip+lat+pulldown" },
    { name: "Chest-Supported Machine Row", type: "Machine", muscle: "Back / Lats", targetReps: "8–12", notes: "Pad adjusted; elbows tight to sides for lats.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+chest+supported+row" },
    { name: "One-Arm Dumbbell Row", type: "Dumbbell", muscle: "Back / Lats", targetReps: "8–10", notes: "Brace hand and knee on bench; pull dumbbell toward hip pocket.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+one+arm+dumbbell+row" }
  ],
  "Machine Overhead Shoulder Press": [
    { name: "Seated Dumbbell Shoulder Press", type: "Dumbbell", muscle: "Shoulders", targetReps: "8–10", notes: "Bench at 75–80°; press dumbbells overhead without clanking.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+shoulder+press" },
    { name: "Smith Machine Overhead Press", type: "Machine", muscle: "Shoulders", targetReps: "8–10", notes: "Seat adjusted; bar passes just in front of nose; elbows tucked 30°.", videoUrl: "https://www.youtube.com/results?search_query=smith+machine+shoulder+press" },
    { name: "Standing Dumbbell Overhead Press", type: "Dumbbell", muscle: "Shoulders", targetReps: "8–10", notes: "Core braced; press overhead with clean vertical bar path.", videoUrl: "https://www.youtube.com/results?search_query=standing+dumbbell+overhead+press" }
  ],
  "Machine Pec Deck Flye": [
    { name: "Standing Cable Crossover / Fly", type: "Cable", muscle: "Chest", targetReps: "10–12", notes: "Pulleys at mid height; hug-a-tree motion; squeeze inner pecs.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+cable+crossover" },
    { name: "Flat Dumbbell Fly", type: "Dumbbell", muscle: "Chest", targetReps: "10–12", notes: "Slight bend in elbows; deep chest stretch at bottom; squeeze up.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+dumbbell+fly" },
    { name: "Incline Cable Fly", type: "Cable", muscle: "Chest", targetReps: "10–12", notes: "Bench at 30°; cables pull from low position up across upper chest.", videoUrl: "https://www.youtube.com/results?search_query=incline+cable+fly" }
  ],
  "Overhead Cable Triceps Extension": [
    { name: "Triceps Rope Pushdown", type: "Cable", muscle: "Triceps", targetReps: "8–12", notes: "Lock elbows at ribs; spread rope at bottom.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+tricep+pushdown" },
    { name: "Standing / Seated DB Overhead Triceps Extension", type: "Dumbbell", muscle: "Triceps", targetReps: "10–12", notes: "Both hands cup DB overhead; deep elbow flexion.", videoUrl: "https://www.youtube.com/results?search_query=overhead+dumbbell+tricep+extension" },
    { name: "Skull Crushers (Dumbbell or EZ-Bar)", type: "Free Weight", muscle: "Triceps", targetReps: "8–12", notes: "Lie flat; lower weight towards forehead; extend back up.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+skull+crushers" }
  ],
  "Incline / Bayonet Cable Curl": [
    { name: "Incline Dumbbell Curl", type: "Dumbbell", muscle: "Biceps", targetReps: "8–12", notes: "Bench at 45–60°; arms hang vertical behind torso for deep stretch.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+incline+dumbbell+curl" },
    { name: "Cable Biceps Curl", type: "Cable", muscle: "Biceps", targetReps: "8–12", notes: "Facing low pulley; elbows locked slightly forward.", videoUrl: "https://www.youtube.com/results?search_query=cable+bicep+curl" },
    { name: "Standing Alternating DB Curl", type: "Dumbbell", muscle: "Biceps", targetReps: "8–12", notes: "Supinate wrists as you curl up; squeeze biceps hard at peak.", videoUrl: "https://www.youtube.com/results?search_query=Jeff+Nippard+bicep+curl" }
  ],
  "Standing Dumbbell Overhead Press": [
    { name: "Machine Overhead Shoulder Press", type: "Machine", muscle: "Shoulders", targetReps: "8–10", notes: "Set seat low; drive straight up without hyper-arching lower back.", videoUrl: "https://www.youtube.com/results?search_query=machine+overhead+press" },
    { name: "Seated Dumbbell Shoulder Press", type: "Dumbbell", muscle: "Shoulders", targetReps: "8–10", notes: "Seated on bench/chair; press dumbbells overhead with control.", videoUrl: "https://www.youtube.com/results?search_query=seated+dumbbell+shoulder+press" },
    { name: "Smith Machine Overhead Press", type: "Machine", muscle: "Shoulders", targetReps: "8–10", notes: "Bar clears nose; elbows tucked 30° into scapular plane.", videoUrl: "https://www.youtube.com/results?search_query=smith+machine+overhead+press" }
  ],
  "Standing Dumbbell Lateral Raise": [
    { name: "Cable Lateral Raise", type: "Cable", muscle: "Shoulders", targetReps: "10–12", notes: "Pulley at wrist/knee height; lead with elbows for side delt isolation.", videoUrl: "https://www.youtube.com/results?search_query=cable+lateral+raise" },
    { name: "Machine Lateral Raise", type: "Machine", muscle: "Shoulders", targetReps: "10–15", notes: "Align pivot with shoulder axis; smooth continuous tension.", videoUrl: "https://www.youtube.com/results?search_query=machine+lateral+raise" },
    { name: "Leaning Dumbbell Lateral Raise", type: "Dumbbell", muscle: "Shoulders", targetReps: "10–12", notes: "Hold pole/rack with one hand; lean away 15° to alter resistance curve.", videoUrl: "https://www.youtube.com/results?search_query=leaning+dumbbell+lateral+raise" }
  ],
  "Standing Dumbbell Biceps / Hammer Curl": [
    { name: "Cable Biceps Curl", type: "Cable", muscle: "Biceps", targetReps: "8–12", notes: "Straight bar or rope; maintain strict elbow position.", videoUrl: "https://www.youtube.com/results?search_query=cable+bicep+curl" },
    { name: "Incline Dumbbell Curl", type: "Dumbbell", muscle: "Biceps", targetReps: "8–12", notes: "Incline bench 45°; maximum stretch on bicep head.", videoUrl: "https://www.youtube.com/results?search_query=incline+dumbbell+curl" },
    { name: "Preacher Curl Machine", type: "Machine", muscle: "Biceps", targetReps: "8–12", notes: "Armpits over pad; eliminate shoulder momentum.", videoUrl: "https://www.youtube.com/results?search_query=preacher+curl" }
  ],
  "Standing / Seated DB Overhead Triceps Extension": [
    { name: "Triceps Rope Pushdown", type: "Cable", muscle: "Triceps", targetReps: "8–12", notes: "Lock elbows at sides; flare rope at full extension.", videoUrl: "https://www.youtube.com/results?search_query=tricep+rope+pushdown" },
    { name: "Overhead Cable Triceps Extension", type: "Cable", muscle: "Triceps", targetReps: "10–12", notes: "Step forward from high/mid pulley; extend arms overhead.", videoUrl: "https://www.youtube.com/results?search_query=overhead+cable+tricep+extension" },
    { name: "Bench Dips (Bodyweight)", type: "Bodyweight", muscle: "Triceps", targetReps: "10–15", notes: "Hands on bench behind hips; lower to 90° elbow bend; press up.", videoUrl: "https://www.youtube.com/results?search_query=bench+dips" }
  ],
  "Standing Bent-Over DB Rear Delt Flye": [
    { name: "Cable Face Pull", type: "Cable", muscle: "Shoulders", targetReps: "10–12", notes: "Rope to eye level; pull toward face while spreading elbows wide.", videoUrl: "https://www.youtube.com/results?search_query=face+pull" },
    { name: "Machine Reverse Pec Deck", type: "Machine", muscle: "Shoulders", targetReps: "10–12", notes: "Chest against pad; pull handles back horizontally.", videoUrl: "https://www.youtube.com/results?search_query=reverse+pec+deck" },
    { name: "Prone Incline DB Rear Delt Flye", type: "Dumbbell", muscle: "Shoulders", targetReps: "10–12", notes: "Lie face down on 30° incline; sweep dumbbells wide.", videoUrl: "https://www.youtube.com/results?search_query=incline+rear+delt+flye" }
  ],
  "Machine Hip Thrust / Glute Drive": [
    { name: "Barbell Hip Thrust", type: "Barbell", muscle: "Glutes", targetReps: "8–10", notes: "Upper back against bench, bar padded across hips; drive hips to horizontal.", videoUrl: "https://www.youtube.com/results?search_query=barbell+hip+thrust" },
    { name: "Dumbbell Romanian Deadlift (RDL)", type: "Dumbbell", muscle: "Glutes / Hamstrings", targetReps: "8–10", notes: "Push hips back with soft knees; feel glute and hamstring stretch.", videoUrl: "https://www.youtube.com/results?search_query=dumbbell+rdl" },
    { name: "Cable Pull-Through", type: "Cable", muscle: "Glutes", targetReps: "10–12", notes: "Face away from low pulley; hinge hips back; snap hips forward to lockout.", videoUrl: "https://www.youtube.com/results?search_query=cable+pull+through" },
    { name: "45° Back Extension (Glute Focus)", type: "Machine", muscle: "Glutes", targetReps: "10–12", notes: "Turn toes out 30°; round upper back slightly to isolate glutes.", videoUrl: "https://www.youtube.com/results?search_query=45+degree+back+extension+for+glutes" }
  ],
  "Horizontal Leg Press": [
    { name: "45° Leg Press", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–12", notes: "Feet shoulder-width on platform; lower sled to 90° knee angle.", videoUrl: "https://www.youtube.com/results?search_query=45+degree+leg+press" },
    { name: "Hack Squat Machine", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–10", notes: "Back glued to pad; descend under control; drive through midfoot.", videoUrl: "https://www.youtube.com/results?search_query=hack+squat" },
    { name: "Dumbbell Goblet Squat", type: "Dumbbell", muscle: "Quads / Glutes", targetReps: "10–12", notes: "Hold heavy DB at chest; keep chest proud; deep controlled squat.", videoUrl: "https://www.youtube.com/results?search_query=dumbbell+goblet+squat" },
    { name: "Smith Machine Squat", type: "Machine", muscle: "Quads / Glutes", targetReps: "8–10", notes: "Feet slightly forward of bar; upright torso; smooth squat cadence.", videoUrl: "https://www.youtube.com/results?search_query=smith+machine+squat" }
  ],
  "Leg Press Calf Press": [
    { name: "Standing Calf Raise Machine", type: "Machine", muscle: "Calves", targetReps: "10–15", notes: "Full stretch at bottom; pause 2s; explode onto balls of feet.", videoUrl: "https://www.youtube.com/results?search_query=standing+calf+raise" },
    { name: "Seated Calf Raise Machine", type: "Machine", muscle: "Calves", targetReps: "12–15", notes: "Knees bent 90°; targets soleus muscle; full stretch pause.", videoUrl: "https://www.youtube.com/results?search_query=seated+calf+raise" },
    { name: "Single-Leg Dumbbell Calf Raise", type: "Dumbbell", muscle: "Calves", targetReps: "12–15", notes: "Hold dumbbell on working side; ball of foot on step; deep pause.", videoUrl: "https://www.youtube.com/results?search_query=single+leg+calf+raise" }
  ],
  "Standing Dumbbell Romanian Deadlift (RDL)": [
    { name: "Barbell Romanian Deadlift", type: "Barbell", muscle: "Hamstrings / Glutes", targetReps: "8–10", notes: "Keep bar skimming shins; push hips back; maintain flat back.", videoUrl: "https://www.youtube.com/results?search_query=barbell+rdl+technique" },
    { name: "45° Back Extension (Glute & Hamstring Focus)", type: "Machine", muscle: "Glutes / Hamstrings", targetReps: "10–12", notes: "Hinge at hips; round upper back slightly to maximize glute contraction.", videoUrl: "https://www.youtube.com/results?search_query=45+degree+back+extension+for+glutes" },
    { name: "Cable Pull-Through", type: "Cable", muscle: "Glutes / Hamstrings", targetReps: "10–12", notes: "Face away from low pulley; hinge hips back; snap hips forward into lockout.", videoUrl: "https://www.youtube.com/results?search_query=cable+pull+through" }
  ],
  "45° Back Extension (Glute & Hamstring Focus)": [
    { name: "Standing Dumbbell Romanian Deadlift (RDL)", type: "Dumbbell", muscle: "Glutes / Hamstrings", targetReps: "8–10", notes: "Push hips back; keep back flat; feel deep stretch in hamstrings and glutes.", videoUrl: "https://www.youtube.com/results?search_query=dumbbell+rdl" },
    { name: "Seated Leg Curl", type: "Machine", muscle: "Hamstrings", targetReps: "8–12", notes: "Thigh pad firmly clamped; curl heels smoothly under seat.", videoUrl: "https://www.youtube.com/results?search_query=seated+leg+curl" },
    { name: "Cable Pull-Through", type: "Cable", muscle: "Glutes / Hamstrings", targetReps: "10–12", notes: "Hinge hips back with rope between legs; extend hips forward.", videoUrl: "https://www.youtube.com/results?search_query=cable+pull+through" }
  ],
  "Captain's Chair Knee Raise": [
    { name: "Kneeling Cable Crunch", type: "Cable", muscle: "Abs / Core", targetReps: "10–12", notes: "Anchor hips in place; actively round ribcage down into pelvis.", videoUrl: "https://www.youtube.com/results?search_query=kneeling+cable+crunch" },
    { name: "Hanging Knee / Leg Raise", type: "Bodyweight", muscle: "Abs / Core", targetReps: "10–12", notes: "Hang from pull-up bar; curl pelvis up towards sternum.", videoUrl: "https://www.youtube.com/results?search_query=hanging+knee+raise" },
    { name: "Decline Bench Sit-Up", type: "Bodyweight", muscle: "Abs / Core", targetReps: "12–15", notes: "Cross arms on chest; round spine smoothly as you curl up.", videoUrl: "https://www.youtube.com/results?search_query=decline+sit+up" }
  ]
};

if (typeof module !== "undefined") { 
  module.exports = { DEFAULT_ROUTINE, EXERCISE_SUBSTITUTIONS }; 
}
