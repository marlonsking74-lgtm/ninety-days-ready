/*
 * 90 Days Ready - plan builder.
 * One file, used in two places:
 *   - the browser (window.PlanBuilder) to show the plan on screen
 *   - the Netlify function (require) to rebuild the plan from answers and email it
 * The server never trusts HTML from the browser. It only accepts answers,
 * validates them here, and renders the email itself.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENUMS = {
    housing: ['house', 'apartment', 'dorm', 'room', 'mobile'],
    tenure: ['own', 'rent', 'na'],
    floor: ['ground', 'mid', 'high'],
    winter: ['cold', 'mild'],
    heat: ['electric', 'gas', 'other', 'unknown'],
    water: ['city', 'well', 'unknown'],
    vehicle: ['yes', 'no'],
    budget: ['tight', 'moderate', 'flexible'],
    foodDays: ['d0', 'd3', 'd8', 'd14'],
    network: ['alone', 'family', 'neighbors']
  };
  var HEALTH = ['dailymeds', 'coldmeds', 'powered', 'dialysis', 'mobility', 'pregnant'];
  var HOUSING_LABEL = {
    house: 'house', apartment: 'apartment or condo', dorm: 'dorm room',
    room: 'rented or shared room', mobile: 'mobile home'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function clampInt(v, min, max, def) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  function pick(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function parseISO(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + 'T00:00:00Z');
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
    return d;
  }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function fmt(d) { return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* Turn raw form input into safe, normalized answers. */
  function validate(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var errors = [];
    var email = typeof raw.email === 'string' ? raw.email.trim() : '';
    if (email && (email.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(email))) {
      errors.push('That email address does not look right.');
    }
    var firstName = typeof raw.firstName === 'string' ? raw.firstName : '';
    firstName = firstName.replace(/[<>&"'\r\n]/g, '').trim().slice(0, 40);

    var adults = clampInt(raw.adults, 1, 12, 1);
    var elders = Math.min(clampInt(raw.elders, 0, 12, 0), adults);
    var health = Array.isArray(raw.health) ? raw.health.filter(function (h, i, arr) {
      return HEALTH.indexOf(h) >= 0 && arr.indexOf(h) === i;
    }) : [];
    var housing = pick(raw.housing, ENUMS.housing, 'apartment');
    var tenure = pick(raw.tenure, ENUMS.tenure, 'rent');
    if (housing === 'dorm') tenure = 'na';
    else if (tenure === 'na') tenure = 'rent';
    var floor = pick(raw.floor, ENUMS.floor, 'ground');
    if (housing === 'house' || housing === 'mobile') floor = 'ground';

    var answers = {
      firstName: firstName,
      email: email,
      startDate: parseISO(raw.startDate) ? raw.startDate : todayISO(),
      adults: adults,
      elders: elders,
      teens: clampInt(raw.teens, 0, 10, 0),
      children: clampInt(raw.children, 0, 10, 0),
      infants: clampInt(raw.infants, 0, 6, 0),
      pets: clampInt(raw.pets, 0, 10, 0),
      housing: housing,
      tenure: tenure,
      floor: floor,
      winter: pick(raw.winter, ENUMS.winter, 'cold'),
      heat: pick(raw.heat, ENUMS.heat, 'unknown'),
      water: pick(raw.water, ENUMS.water, 'city'),
      health: health,
      vehicle: pick(raw.vehicle, ENUMS.vehicle, 'yes'),
      budget: pick(raw.budget, ENUMS.budget, 'moderate'),
      foodDays: pick(raw.foodDays, ENUMS.foodDays, 'd3'),
      network: pick(raw.network, ENUMS.network, 'family')
    };
    return { ok: errors.length === 0, errors: errors, answers: answers };
  }

  /* Build the plan object from normalized answers. Pure: same answers, same plan. */
  function buildPlan(a) {
    var people = a.adults + a.teens + a.children + a.infants;
    var kids = a.teens + a.children + a.infants;
    var small = a.housing === 'dorm' || a.housing === 'room';
    var midDays = small ? 7 : 14;
    var finalDays = small ? 14 : 30;
    var has = function (h) { return a.health.indexOf(h) >= 0; };
    var start = parseISO(a.startDate) || parseISO(todayISO());
    var range = function (from, to) { return fmt(addDays(start, from - 1)) + ' to ' + fmt(addDays(start, to - 1)); };
    var who = people === 1 ? 'you' : 'your household of ' + people;

    /* ---------- Summary numbers ---------- */
    var numbers = [
      { label: 'People covered', value: String(people) },
      { label: 'Water for 3 days', value: people * 3 + ' gal' },
      { label: 'Water for ' + midDays + ' days', value: people * midDays + ' gal' },
      { label: 'Food target by Day 90', value: finalDays + ' days' }
    ];

    var notes = [];
    notes.push('Built for ' + who + ' in a ' + HOUSING_LABEL[a.housing] + ', starting ' + fmt(start) + '.');
    if (small) notes.push('Storage is tight where you live, so the targets are ' + midDays + ' days by Day 30 and ' + finalDays + ' days by Day 90. Your network carries the rest.');
    if (a.budget === 'tight') notes.push('Money is tight, so free steps come first: the family plan, tap water in clean bottles, your papers, and your people. Add one or two shelf items per grocery trip. Never borrow to prep.');
    if (a.budget === 'flexible') notes.push('You have room to spend. Spread it out anyway, and put the first dollars into water, medicine, and light before gadgets.');

    notes.push('General information, not legal or medical advice. Check with your own doctor and your state\'s rules.');

    /* ---------- Days 1-7 ---------- */
    var w1 = [];
    w1.push('Fill clean, food-grade bottles and jugs with tap water until you have ' + people * 3 + ' gallons (1 gallon per person per day, 3 days). Skip old milk jugs, which are hard to get clean. Date each one and refill every 6 months.');
    if (a.foodDays === 'd0') w1.push('Your pantry holds under 3 days. Food is this week\'s first buy: rice, canned beans, canned fish, peanut butter, oats, grits.');
    else if (a.foodDays === 'd3') w1.push('You have a few days of food. Top it up to a solid 7 days of shelf food you already eat.');
    else w1.push('You already have a week or more of food. Check dates, then put this week\'s money into water, light, and medicine instead.');
    w1.push('Write five phone numbers on paper for every person in the home. Phones die.');
    w1.push('Pick two meeting spots (one near home, one outside the neighborhood) and one out-of-state contact everyone checks in with.');
    w1.push('Set the rule: text first, call second.');
    w1.push('Get one flashlight or headlamp per person (' + people + '), spare batteries, and a battery or hand-crank radio.');
    w1.push('Get a battery-powered carbon monoxide alarm and one power bank per phone.');
    if (a.health.length) w1.push('Count the medicine today. For each daily prescription, write down how many days are left.');
    if (a.housing === 'dorm') {
      w1.push('Read the campus emergency plan and sign up for campus alerts.');
      w1.push('Send family your dorm name, room number, and your RA\'s name and number.');
    } else {
      w1.push('Find the water shutoff, the breaker box' + (a.floor !== 'ground' ? ', and every stairwell' : '') + '.');
    }
    if (a.water === 'unknown') w1.push('Find out whether your water is city water or a well. It changes the plan.');
    if (a.water === 'well') w1.push('Your well pump needs electricity. No power means no water, so stored water is your number one priority.');
    if (a.network === 'alone') w1.push('You live alone, so check-ins matter more. Pick one person this week who expects a daily text from you. A missed text means they come knock.');
    if (kids) w1.push('Decide which adult picks up which child, and tell the school or sitter who is allowed.');
    if (a.elders) w1.push('Decide who checks on ' + (a.elders === 1 ? 'your elder' : 'each elder') + ' and how often.');

    /* ---------- Days 8-30 ---------- */
    var m1 = [];
    m1.push('Build stored water to ' + people * midDays + ' gallons (' + midDays + ' days). Stack it in closets and under beds.');
    m1.push('Learn to treat water. Boiling for 1 minute is best. Or use plain unscented bleach: 8 drops per gallon if the label says 6%, 6 drops if it says 8.25%. Double it for cloudy or very cold water, then wait 30 minutes. No scented, splashless, or color-safe bleach.');
    m1.push('Build shelf food to ' + midDays + ' days for ' + plural(people, 'person', 'people') + '. Choose low-sodium cans where you can.');
    m1.push('Get a manual can opener.');
    if (a.housing === 'dorm') m1.push('Dorms ban stoves and open flame. Stock no-cook food only: canned fish, peanut butter, crackers, oats, dried fruit, shelf-stable milk.');
    else m1.push('Plan no-cook meals for the first days and one safe way to heat food. Camp stoves and grills are for outdoors only, and fuel is stored away from heat and living space.');
    if (a.infants) m1.push('For ' + plural(a.infants, 'baby', 'babies') + ': stock ready-to-feed formula if you use formula (it needs no water), plus diapers and wipes. A rough count is 8 diapers a day per baby. Powdered formula needs safe water: bottled, or boiled and cooled.');
    if (a.infants) m1.push('Babies sleep on their backs in their own flat space, dressed in layers or a wearable blanket. No quilts, pillows, or sleeping bags on a baby, even in a cold room.');
    if (a.children) m1.push('Add comfort items for the children: favorite snacks, books, cards, a small toy each.');
    if (a.pets) m1.push('For ' + plural(a.pets, 'pet', 'pets') + ': two weeks of food, extra water, a carrier or leash, and vaccination records.');

    if (has('dailymeds')) m1.push('Ask your doctor and pharmacist about a 90-day supply and early-refill rules. Aim for a 30-day cushion of every daily medicine. Use the oldest first so nothing expires. Never skip or cut doses to stretch a supply without asking your doctor or pharmacist.');
    if (has('coldmeds')) m1.push('Ask your pharmacist exactly how to keep refrigerated medicine (such as insulin) safe without power, and buy a cooling case made for it. If it is insulin: never let it freeze, never use insulin that has frozen, and keep glucose tablets or juice, spare test strips, and meter batteries with it.');
    if (has('powered')) {
      m1.push('Call the electric company and ask to be put on its medical needs list. That does not guarantee your power comes back first, so plan backup power anyway.');
      m1.push('If anyone uses oxygen: no candles, smoking, or open flame near it, and ask the supplier about backup tanks.');
      m1.push('Ask your equipment supplier about battery backup and how long it lasts. Learn the nearest place with backup power, such as a hospital or fire station.');
    }
    if (has('dialysis')) m1.push('Ask your dialysis clinic for its emergency plan, a backup clinic, and the emergency diet sheet. Keep them on paper.');
    if (has('dialysis')) m1.push('Build your food stock from the clinic\'s list. Common storage foods like beans, potatoes, and salt substitutes can be dangerous on dialysis.');
    if (has('mobility')) m1.push('Name the person who helps with stairs and exits, and keep supplies within easy reach, not on high shelves.');
    if (has('pregnant')) m1.push('Ask your provider what to do if you cannot reach the hospital, and stock newborn basics early.');
    if (a.health.length) m1.push('Write a paper list for each person: conditions, medicines, doses, doctors, pharmacy.');
    m1.push('Buy a real first aid kit' + (a.adults > 0 ? ', a thermometer, and a home blood pressure cuff. Share the readings with your doctor and do not change doses on your own' : '') + '.');
    if (a.elders) m1.push('For elders: spare glasses, hearing aid batteries, and a written daily check-in time.');

    if (a.winter === 'cold') {
      if (a.heat === 'electric') m1.push('Your heat is electric, so it goes out with the power. Build the warm-room kit now: one sleeping bag or heavy quilt per person, thermal layers, hats, wool socks.');
      else if (a.heat === 'gas') m1.push('A gas furnace still needs electricity for its blower and thermostat. Plan as if the heat is out: one sleeping bag or heavy quilt per person, thermal layers, hats, wool socks.');
      else m1.push('Plan one warm room: one sleeping bag or heavy quilt per person, thermal layers, hats, wool socks.');
      m1.push('Never heat with an oven, a grill, or a generator indoors. Carbon monoxide has no smell. A generator runs outside only, at least 20 feet from the home. Never run a car in a garage to warm up or charge phones.');
      m1.push('If the carbon monoxide alarm sounds, get everyone outside and call 911. Treat headache, dizziness, or nausea during an outage the same way.');
      if (a.housing === 'mobile') m1.push('Mobile homes lose heat fast and pipes freeze early. Know how to shut off and drain your water, and know the nearest warming center.');
    } else {
      m1.push('Plan for heat as well as cold: battery fans, shade for windows, and extra drinking water. In extreme heat a fan is not enough, so know your nearest cooling center.');
    }
    m1.push('Start a cash reserve in small bills. First target: one week of groceries and ' + (a.vehicle === 'yes' ? 'gas' : 'rides') + '. Card readers and ATMs need power.');
    if (a.vehicle === 'yes') m1.push('Keep the gas tank above half. Put a blanket, water, and a phone charger in the car.');
    else m1.push('No car: ask two people with cars to be your ride in an emergency. Learn the walking and transit route to both meeting spots.');

    /* ---------- Days 31-60 ---------- */
    var m2 = [];
    var EXITS = 'Fire comes first: every person must be able to open every exit in seconds, in the dark. Leave one window in each bedroom free to open as a fire exit, and practice removing the bar and dowels.';
    if (a.housing === 'dorm') {
      m2.push('You cannot change dorm doors, so use what you control: lock up every time, know two exits from your floor, and keep valuables and papers in a small lockbox.');
    } else if (a.tenure === 'rent') {
      m2.push('Harden the door the renter way: swap the short hinge and strike-plate screws for 3-inch screws, add a door security bar, and put dowels in window and sliding-door tracks. All reversible. Check your lease first.');
      m2.push(EXITS);
      m2.push('Save your landlord\'s emergency number and keep a paper copy of the lease.');
    } else {
      m2.push('Harden the doors: 3-inch screws in hinges and strike plates, a door security bar, and dowels in window and sliding-door tracks.');
      m2.push(EXITS);
    }
    if (a.housing !== 'dorm') m2.push('Check smoke alarms and place a fire extinguisher in the kitchen.');
    if (a.floor === 'high') {
      m2.push('Above the fifth floor, elevators and water pumps stop without power. Keep all your water inside the unit and practice the stairs once.');
      if (has('mobility') || a.elders) m2.push('Someone here may not manage the stairs. Tell building management now, and ask the fire department\'s non-emergency line how they handle it.');
    } else if (a.floor === 'mid' && has('mobility')) {
      m2.push('Elevators stop without power. Tell building management that someone here cannot use the stairs.');
    }
    m2.push('Cover windows at night during an outage, and keep your prep quiet. Share plans with people you trust, not social media.');
    m2.push('Learn your state\'s self-defense law from a state bar or legal aid source. De-escalation comes first.');
    m2.push('Learn the script for police contact: stay calm, hands visible, "Am I free to go?", "I do not consent to a search," "I am going to remain silent," "I want a lawyer." Never run, resist, or reach suddenly. In a car, the driver hands over license, registration, and insurance when asked. Some states require you to give your name when police ask for it.');
    m2.push('Write legal aid numbers on paper: NAACP Legal Defense Fund, your state ACLU, local legal aid.');
    if (a.teens) m2.push('Walk the teens through the rights script and the curfew rule: comply, document, challenge later.');

    if (a.housing === 'dorm') {
      m2.push('Keep copies of your ID, student ID, and insurance card in a waterproof bag. Leave originals of birth certificate and Social Security card with family.');
    } else {
      m2.push('Build a go-folder in a waterproof bag: IDs, birth certificates, Social Security cards, ' + (a.tenure === 'own' ? 'deed' : 'lease') + ', insurance, medical lists, and a photo of each person.');
      m2.push('Scan the go-folder to an encrypted USB drive and leave a copy with trusted family in another city.');
    }
    if (a.tenure === 'own') {
      m2.push('Confirm your name is on the deed. If the home was passed down without a will, see legal aid about clearing the title. Many families without clear title were denied rebuilding aid after Katrina.');
      m2.push('Read your homeowners policy for what it covers in an outage or freeze, and photograph every room.');
    } else if (a.tenure === 'rent') {
      m2.push('Get renters insurance if you have none, and photograph every room.');
    }
    if (a.adults > 0 && a.housing !== 'dorm') m2.push('Every adult writes a will' + (kids ? ' and names who takes the children' : '') + '. Sign and witness it the way your state requires, or it may not count. Legal aid can help.');
    m2.push('Grow the cash reserve toward one month of bare essentials, split between two hiding places. A fire-resistant pouch or box protects it.');
    m2.push('Open a second account at a credit union or Black-owned bank, and print one statement for every account and debt.');
    if (!small) {
      m2.push('Build a sanitation kit: 5-gallon bucket with a seat lid, heavy bags, kitty litter, soap, bleach, and menstrual supplies. Never mix bleach with ammonia or other cleaners, and never pour bleach into the toilet bucket.');
      m2.push('Extend food toward ' + finalDays + ' days.');
    } else {
      m2.push('Build a small sanitation kit: heavy bags, wipes, soap, hand sanitizer, and menstrual supplies.');
    }
    m2.push('Pack a go-bag per person (' + people + '): 3 days of basics, copies of papers, cash, medicine.');
    if (a.housing === 'dorm') m2.push('Plan the trip home or to family within a day\'s travel: the route, the ride, and a backup for each.');
    if (a.budget === 'flexible' && !small) m2.push('If money allows, add a gravity water filter and a portable power station sized for phones, lights, and any medical device.');
    else if (a.budget !== 'tight') m2.push('If money allows, add a gravity or pump water filter.');

    /* ---------- Days 61-90 ---------- */
    var m3 = [];
    if (a.housing === 'dorm') {
      m3.push('Pick three to five people on your floor you trust. Swap numbers on paper and agree to check on each other.');
      m3.push('Ask your RA where students gather and where news is posted if phones are down.');
    } else {
      m3.push('Pick five households you trust' + (a.network === 'alone' ? ', starting with your daily check-in buddy' : a.network === 'family' ? ', starting with family nearby' : ', starting with the neighbors you already know') + '.');
      m3.push('Hold one 60-minute meeting with food: who is most at risk, who has which skills and gear, who knocks on whose door.');
      m3.push('Build a paper roster: names, addresses, numbers, skills, needs.');
      m3.push('Name a hub where people gather and news gets posted: a church, mosque, barbershop, or community room.');
      m3.push('Pool money for bulk rice, beans, and water. Share the big items instead of each buying one.');
    }
    m3.push('Get a pair of FRS walkie-talkies (no license needed). Agree on a channel and two check-in times a day.');
    if (a.network === 'alone') m3.push('Add a second check-in buddy so one missed text never leaves you uncovered.');
    if (a.children || a.teens) m3.push('Give the young people real jobs: flashlight captain, water counter, the one who knows the meeting spots.');
    if (a.elders) m3.push('Ask the elders how they got through hard winters and storms. Write it down.');
    m3.push('Mark a paper map: hospitals, fire stations, pharmacies, warming centers, and your meeting spots.');
    m3.push('Run a 24-hour lights-out drill at home: lights and screens off, phones on airplane mode, stored food and water only. Keep the heat, the fridge, and any medical equipment running. Write down what failed and fix the top three.');
    if (small) m3.push('Confirm the count: ' + people * finalDays + ' gallons of water and ' + finalDays + ' days of food, plus a known place to go if the outage runs long.');
    else m3.push('Confirm the count: ' + people * midDays + ' gallons stored plus a filter and a known backup source (or ' + people * finalDays + ' gallons if space allows), ' + finalDays + ' days of food, one month of cash.');

    /* ---------- If the lights go out ---------- */
    var out = [];
    out.push('Check whether it is just you: the breaker, then neighbors, then the utility outage line.');
    out.push('Turn on the battery radio. Trust official local sources, not forwarded videos.');
    out.push(a.water === 'well' ? 'Your well pump is down. Switch to stored water right away.' : 'Fill the bathtub and every pot while water pressure lasts' + (a.floor === 'high' ? '. In a tall building that may be minutes.' : '.') + ' Tub water is for flushing and washing. Treat it before drinking.' + ((a.children || a.infants) ? ' Keep small children away from a filled tub.' : ''));
    out.push('Keep the fridge and freezer closed. A closed fridge holds about 4 hours, a full freezer about 48, a half-full one about 24.');
    out.push('After 4 hours without power, throw out meat, fish, eggs, milk, and leftovers unless they went into a cooler with ice. Never taste food to test it.');
    out.push('If you smell gas, leave at once and call the gas company or 911 from outside.');
    out.push('Text your out-of-state contact: who is where, and that you are okay.');
    if (has('coldmeds')) out.push('Move refrigerated medicine to its cooling case the way your pharmacist showed you.');
    if (has('powered')) out.push('Switch medical equipment to backup power and start the clock. Leave for a powered location before the battery is half gone.');
    if (has('dialysis')) out.push('Call your dialysis clinic or its backup, and follow the emergency diet they gave you.');
    if (a.winter === 'cold') out.push('Move everyone into the warm room at night and check the carbon monoxide alarm.');
    if (a.winter === 'cold' && (a.elders || a.infants)) out.push('Watch elders and babies closely for cold. In adults: shivering, confusion, fumbling hands, slurred speech, or drowsiness. In babies: bright red, cold skin or very low energy. Warm them and call 911. A body temperature under 95 F is an emergency.');
    if (a.elders || a.network !== 'alone') out.push('Check on elders and anyone on medical equipment twice a day.');
    out.push('Leave if there is no safe water, no heat in freezing weather, a medical need you cannot meet, or danger you cannot avoid. Go early, in daylight, to a place that expects you.');
    out.push('Official evacuation or shelter orders override this plan.');

    var sections = [
      { id: 'week1', heading: 'Days 1-7: start now', dates: range(1, 7), goal: 'Three days of water and food, and a family plan on paper.', items: w1 },
      { id: 'month1', heading: 'Days 8-30: the foundation', dates: range(8, 30), goal: midDays + ' days of water, food, medicine, light, and cash.', items: m1 },
      { id: 'month2', heading: 'Days 31-60: fortify', dates: range(31, 60), goal: 'Home secured, rights known, papers and money protected.', items: m2 },
      { id: 'month3', heading: 'Days 61-90: build the network', dates: range(61, 90), goal: 'People you can count on, and one full drill.', items: m3 },
      { id: 'outage', heading: 'If the lights go out', dates: '', goal: 'Stay home, stay calm, get facts before acting.', items: out }
    ];

    var wallet = [
      'My name and address', 'Out-of-state contact', 'Two family phone numbers',
      'Meeting spot 1 (near home)', 'Meeting spot 2 (outside the neighborhood)',
      'Radio channel and check-in times'
    ];
    if (a.health.length) wallet.push('Conditions and medicines');
    wallet.push('Legal aid number');

    return {
      title: (a.firstName ? a.firstName + '\'s ' : 'Your ') + '90 Days Ready plan',
      numbers: numbers,
      notes: notes,
      sections: sections,
      wallet: wallet,
      disclaimers: [
        'No agency has announced a 90-day blackout. That number comes from a Pentagon readiness target for military bases. This plan is for the outages that do happen: storms, cold snaps, and grid strain.',
        'This plan is general preparedness information. It is not legal or medical advice and creates no lawyer or doctor relationship. It does not replace your doctor, a lawyer, or official emergency instructions. Laws vary by state.',
        'Do not go into debt to prepare, and do not buy "blackout" crypto or miracle gadgets.'
      ]
    };
  }

  /* Email-safe HTML: inline styles, no scripts, every dynamic string escaped. */
  function renderEmail(plan) {
    var h = [];
    h.push('<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#16201b;line-height:1.5;font-size:16px">');
    h.push('<h1 style="font-size:24px;margin:0 0 8px">' + esc(plan.title) + '</h1>');
    plan.notes.forEach(function (n) { h.push('<p style="margin:0 0 8px">' + esc(n) + '</p>'); });
    h.push('<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;width:100%">');
    plan.numbers.forEach(function (n) {
      h.push('<tr><td style="padding:6px 0;border-bottom:1px solid #d5ddd8">' + esc(n.label) + '</td><td style="padding:6px 0;border-bottom:1px solid #d5ddd8;text-align:right;font-weight:bold">' + esc(n.value) + '</td></tr>');
    });
    h.push('</table>');
    plan.sections.forEach(function (s) {
      h.push('<h2 style="font-size:19px;margin:24px 0 4px;color:#17603f">' + esc(s.heading) + '</h2>');
      if (s.dates) h.push('<p style="margin:0;color:#55635b;font-size:14px">' + esc(s.dates) + '</p>');
      h.push('<p style="margin:4px 0 8px"><strong>Goal:</strong> ' + esc(s.goal) + '</p>');
      h.push('<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">');
      s.items.forEach(function (it) {
        h.push('<tr><td style="vertical-align:top;padding:5px 8px 5px 0;width:20px;font-size:18px;line-height:1.2">&#9744;</td><td style="padding:5px 0">' + esc(it) + '</td></tr>');
      });
      h.push('</table>');
    });
    h.push('<h2 style="font-size:19px;margin:24px 0 4px;color:#17603f">Wallet card</h2>');
    h.push('<p style="margin:0 0 8px">Copy by hand, one per person.</p>');
    plan.wallet.forEach(function (w) {
      h.push('<p style="margin:0 0 10px;border-bottom:1px solid #9aa8a0;padding-bottom:14px">' + esc(w) + ':</p>');
    });
    h.push('<p style="margin:0 0 10px"><strong>If stopped:</strong> "Am I free to go? I do not consent to a search. I am going to remain silent. I want a lawyer."</p>');
    h.push('<hr style="border:0;border-top:1px solid #d5ddd8;margin:24px 0 12px">');
    plan.disclaimers.forEach(function (d) { h.push('<p style="margin:0 0 8px;font-size:13px;color:#55635b">' + esc(d) + '</p>'); });
    h.push('</div>');
    return h.join('');
  }

  /* Plain text, for the Copy button and the email's text part. */
  function renderText(plan) {
    var t = [plan.title.toUpperCase(), ''];
    plan.notes.forEach(function (n) { t.push(n); });
    t.push('');
    plan.numbers.forEach(function (n) { t.push(n.label + ': ' + n.value); });
    plan.sections.forEach(function (s) {
      t.push('', s.heading.toUpperCase() + (s.dates ? ' (' + s.dates + ')' : ''), 'Goal: ' + s.goal);
      s.items.forEach(function (it) { t.push('[ ] ' + it); });
    });
    t.push('', 'WALLET CARD (copy by hand, one per person)');
    plan.wallet.forEach(function (w) { t.push(w + ': ________'); });
    t.push('If stopped: "Am I free to go? I do not consent to a search. I am going to remain silent. I want a lawyer."', '');
    plan.disclaimers.forEach(function (d) { t.push(d); });
    return t.join('\n');
  }

  return {
    ENUMS: ENUMS, HEALTH: HEALTH,
    validate: validate, buildPlan: buildPlan,
    renderEmail: renderEmail, renderText: renderText, escapeHtml: esc
  };
});
