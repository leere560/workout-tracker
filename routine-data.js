// Pre-loaded routine parsed from 4-Day_Machine_lifting_routine.xlsx
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
        "targetReps": "6–9",
        "startingWeight": "100–120 lbs",
        "rest": "2–3 min",
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
        "targetReps": "8–11",
        "startingWeight": "110–130 lbs",
        "rest": "2–3 min",
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
        "targetReps": "12–15",
        "startingWeight": "10–15 lbs",
        "rest": "60–90 sec",
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
        "targetReps": "10–12",
        "startingWeight": "40–50 lbs",
        "rest": "60–90 sec",
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
        "targetReps": "10–12",
        "startingWeight": "40–50 lbs",
        "rest": "60–90 sec",
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
        "targetReps": "12–15",
        "startingWeight": "30–40 lbs",
        "rest": "60 sec",
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
        "targetReps": "6–10",
        "startingWeight": "140 lbs",
        "rest": "2.5–3 min",
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
        "targetReps": "10–14",
        "startingWeight": "80–100 lbs",
        "rest": "90 sec–2 min",
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
        "targetReps": "10–15",
        "startingWeight": "120–150 lbs",
        "rest": "60–90 sec",
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
        "targetReps": "12–15",
        "startingWeight": "60–80 lbs",
        "rest": "60 sec",
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
        "targetReps": "6–10",
        "startingWeight": "Bar + 50–70 lbs",
        "rest": "2–3 min",
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
        "rest": "90 sec",
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
        "targetReps": "8–10",
        "startingWeight": "70–90 lbs",
        "rest": "2–3 min",
        "notes": "Set seat low so handles start level with ears; drive straight up without hyper-arching lower back.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+shoulder+press+technique",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "sat___upper_b_ex4",
        "name": "Machine Pec Deck Flye",
        "muscle": "Chest",
        "sets": 2,
        "targetReps": "10–14",
        "startingWeight": "70–90 lbs",
        "rest": "90 sec",
        "notes": "Soft bend in elbows; squeeze chest together without shrugging shoulders forward; deep stretch.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+chest+flye+pec+deck",
        "isOptional": true,
        "superset": null
      },
      {
        "id": "sat___upper_b_ex5",
        "name": "Overhead Cable Triceps Extension",
        "muscle": "Triceps",
        "sets": 3,
        "targetReps": "10–14",
        "startingWeight": "35–45 lbs",
        "rest": "60–90 sec",
        "notes": "Top cable setting; face away from stack; stretch long head of triceps fully behind neck.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+overhead+cable+tricep+extension",
        "isOptional": false,
        "superset": {
          "id": "upper_b_arms",
          "tag": "5A",
          "name": "Cable Arm Superset (Long-head Triceps + Lengthened Biceps)",
          "tip": "⚡ Superset: Same cable station! Do Overhead Extension, rest 45s, do Bayonet Curl, rest 60s. Saves ~6 mins!",
          "rest": "45–60 sec"
        }
      },
      {
        "id": "sat___upper_b_ex6",
        "name": "Incline / Bayonet Cable Curl",
        "muscle": "Biceps",
        "sets": 3,
        "targetReps": "10–12",
        "startingWeight": "25–35 lbs",
        "rest": "60–90 sec",
        "notes": "Pulley at mid-height; step forward so cables pull arms behind torso for deep lengthened stretch.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+behind+the+back+cable+curl",
        "isOptional": false,
        "superset": {
          "id": "upper_b_arms",
          "tag": "5B",
          "name": "Cable Arm Superset (Long-head Triceps + Lengthened Biceps)",
          "tip": "⚡ Superset: Alternate with Overhead Triceps Extensions. Saves ~6 mins!",
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
        "targetReps": "10–15",
        "startingWeight": "Light (find weight)",
        "rest": "2 min",
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
        "targetReps": "10–12",
        "startingWeight": "180–230 lbs",
        "rest": "2 min",
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
        "targetReps": "10–12",
        "startingWeight": "140–180 lbs",
        "rest": "60–90 sec",
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
        "targetReps": "10–12",
        "startingWeight": "70–90 lbs",
        "rest": "90 sec",
        "notes": "Keep hips pinned flat into the pad; avoid hyperextending lower back; control the negative.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+lying+leg+curl",
        "isOptional": false,
        "superset": null
      },
      {
        "id": "mon__lower_b_ex_back_ext",
        "name": "45-Degree Back Extension",
        "muscle": "Glutes / Hamstrings",
        "sets": 2,
        "targetReps": "10–15",
        "startingWeight": "Bodyweight",
        "rest": "90 sec",
        "notes": "Pad just below the hip crease, feet secured, hinge slowly at the hips while keeping the spine comfortably steady. Rise until torso and legs align; don’t swing or arch backward. Effort: finish with 3–4 clean reps in reserve (start with just 1 set for the first two sessions).",
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
        "rest": "60 sec",
        "notes": "Forearms locked on pads; pull knees up while actively rolling pelvis toward your chest.",
        "videoUrl": "https://www.youtube.com/results?search_query=Jeff+Nippard+hanging+knee+raise+technique",
        "isOptional": true,
        "superset": null
      }
    ]
  }
];

if (typeof module !== "undefined") { module.exports = { DEFAULT_ROUTINE }; }
