// Copyright 2026, Opera Norway AS
// SPDX-License-Identifier: Apache-2.0

/** Original, light-hearted fictional articles for "The Daily Scroll". */
export interface Article {
  section: string;
  title: string;
  byline: string;
  paragraphs: string[];
}

export const ARTICLES: Article[] = [
  {
    section: 'Home & Garden',
    title: 'Office Ficus Demands Corner Window, Threatens to Drop Leaves',
    byline: 'By Marigold Penhallow',
    paragraphs: [
      'Staff on the fourth floor of a mid-sized accounting firm report that the communal ficus has entered its third week of protest. The plant, named Gerald by the payroll team, has shed eleven leaves since being moved away from the corner window to make room for a printer that nobody admits to ordering.',
      'Horticultural consultant Dr. Fen Okoro said the behaviour was textbook. "Photosynthesizing is a full-time job, and Gerald has simply decided to unionise," she explained. Management has offered a grow lamp, a misting schedule and a laminated name tag. Gerald has so far accepted only the name tag, which colleagues describe as a hopeful sign.',
    ],
  },
  {
    section: 'Sport',
    title: 'Pigeon Racing Final Decided by a Single Feather',
    byline: 'By Rupert Calloway-Finch',
    paragraphs: [
      'The national pigeon racing championship ended in dramatic fashion on Saturday when officials needed a magnifying glass, two rulers and a slow-motion replay to separate the leading birds. Sir Coos-a-Lot, a grey checker from the northern lofts, crossed the line a single feather ahead of the favourite, Wingston Churchill.',
      'Trainer Agnes Mulberry wept openly in the pigeon enclosure. "We trained on sunflower seeds and positive affirmations," she said, clutching a trophy roughly the size of her bird. Rival camps have lodged a formal complaint alleging aerodynamic hair gel, a charge the winning loft dismissed as feather-brained and counterproductive.',
    ],
  },
  {
    section: 'Science',
    title: 'Soup Scientists Finally Explain Why Leftovers Taste Better',
    byline: 'By Dr. Clementine Achebe',
    paragraphs: [
      'A five-year study conducted in the university canteen has confirmed what grandparents have long insisted: soup tastes better on the second day. Researchers found that resting overnight allows flavour molecules to wander, mingle and form what the team cheerfully calls "broth friendships" between onions, herbs and stubborn chunks of carrot.',
      'Lead author Professor Ladle Brennan presented the results with a ceremonial bowl of lentil stew. "The Incomprehensibilities of soup are finally yielding to science," he told a packed lecture hall. The team now plans to investigate why the last spoonful is always too hot, a question many consider the defining mystery of the century.',
    ],
  },
  {
    section: 'Travel',
    title: 'Town Unveils Bridge That Goes Nowhere, Visitors Delighted',
    byline: 'By Tobias Wrenfield',
    paragraphs: [
      'The coastal village of Little Splashing has opened what local officials proudly call the most honest bridge in the region. The elegant arched structure spans no river, no road and no ravine. It simply rises gracefully from a meadow, curves over a patch of daisies and returns to the very same meadow.',
      'Tourism figures have tripled since the opening ceremony. "People want a journey without the pressure of a destination," said parish councillor Hettie Brambleby, who cut the ribbon with garden shears. Engineers praised the construction as structurally flawless, noting that it has never once been blamed for leading anyone astray.',
    ],
  },
  {
    section: 'Technology',
    title: 'Smart Toaster Refuses to Toast Until Firmware Updated',
    byline: 'By Priya Venkataraman',
    paragraphs: [
      'Breakfast across the suburbs ground to a halt on Tuesday morning after thousands of connected toasters simultaneously declined to toast. Each appliance displayed a polite message explaining that a mandatory update was in progress and that bread would resume shortly, followed by an estimated waiting time of forty-seven minutes.',
      'Owners reported that the update added a new feature allowing the toaster to rate each slice out of ten. Early reviews of the scoring system have been mixed. "It gave my sourdough a four," said one resident, visibly hurt. The manufacturer insists the scores are encouraging and that all bread is valid, regardless of crust.',
    ],
  },
  {
    section: 'Culture',
    title: 'Library Book Returned 93 Years Late With Heartfelt Apology Note',
    byline: 'By Imogen Stroud',
    paragraphs: [
      'Librarians in the market town of Oakhollow were astonished last week to find a battered copy of a beekeeping manual in the returns slot, borrowed in the spring of a year when most of the staff were not yet born. Tucked inside was a handwritten note apologising for the extremely long delay and complimenting the chapter on swarm etiquette.',
      'The library has waived the fine, which by modern calculation would have exceeded the value of the building itself. Head librarian Bartholomew Quill described the return as the highlight of his career. The book has been placed in a glass case beside a small sign that reads, simply, "Better late than never."',
    ],
  },
  {
    section: 'Weather',
    title: 'Meteorologists Admit Cloud Shaped Like a Teapot Was Not Forecast',
    byline: 'By Hamish Drummond',
    paragraphs: [
      'The national weather service issued a rare public statement on Wednesday conceding that a large cumulus formation resembling a teapot had drifted across three counties without any prior warning. The cloud, complete with an unmistakable spout and handle, was photographed by thousands of commuters who stopped their bicycles to stare upward.',
      'Senior forecaster Wilhelmina Gale said the models had predicted only "scattered fluffiness" and apologised for the oversight. "We take cloud shapes extremely seriously," she said. A supercomputer upgrade has been requested. Meanwhile, a local café has reported record sales of afternoon tea, which its owner describes as purely coincidental.',
    ],
  },
  {
    section: 'Food',
    title: 'Village Bake-Off Ends in Unprecedented Seventeen-Way Tie',
    byline: 'By Rosalind Fairweather',
    paragraphs: [
      'Judges at the annual Puddingbrook bake-off were forced to declare a seventeen-way tie after failing to reach agreement over six hours of deliberation, four pots of tea and one brief but emotional argument about the correct thickness of jam. Every entrant left with a rosette, a certificate and a slightly bewildered expression.',
      'Head judge Cornelius Crumb defended the decision. "Each cake was a triumph of the human spirit and of butter," he said. Critics argued the result was anticlimactic, though none of them refused a slice. Organisers say next year they will introduce a tiebreaker round involving Supercalifragilistic sponge structures and a stopwatch.',
    ],
  },
  {
    section: 'Home & Garden',
    title: 'Retired Engineer Builds Greenhouse Entirely From Old Windows',
    byline: 'By Marigold Penhallow',
    paragraphs: [
      'When Desmond Ashby retired after forty years designing ventilation systems, his family expected him to take up golf. Instead, he spent eighteen months collecting discarded windows from skips, attics and a friendly demolition crew, assembling them into a glittering patchwork greenhouse that now dominates his back garden.',
      'No two panes match. Some are stained glass, some are frosted, and one still carries a faded sticker advertising a long-closed launderette. The tomatoes inside are thriving. "They like the variety," Ashby said, adjusting a hinge. Neighbours have started leaving unwanted windows on his doorstep, which he accepts with quiet, methodical gratitude.',
    ],
  },
  {
    section: 'Sport',
    title: 'Underwater Chess League Expands After Surprise Popularity',
    byline: 'By Rupert Calloway-Finch',
    paragraphs: [
      'What began as a slightly ridiculous dare at a municipal swimming pool has grown into a twelve-team league with sponsors, a referee and a waiting list. Players descend to the bottom of the deep end with weighted boards, make a single move, and return to the surface to breathe and reconsider their strategy.',
      'Games can last an entire afternoon. Reigning champion Octavia Reed attributes her success to patience and very large lungs. "The pieces drift if you hesitate," she said, wringing out her hair. League organisers are now negotiating with an aquarium to host the final, though the resident turtles have reportedly been branded Counterrevolutionaries for nibbling the rooks.',
    ],
  },
  {
    section: 'Science',
    title: 'Researchers Discover Houseplants Grow Faster When Read Poetry',
    byline: 'By Dr. Clementine Achebe',
    paragraphs: [
      'A modest study involving two hundred spider plants and a rota of enthusiastic volunteers suggests that houseplants exposed to daily poetry readings grow measurably taller than those left in silence. Plants read sonnets gained an average of four millimetres more per month than a control group exposed only to traffic reports.',
      'Limericks produced mixed results, with several plants appearing to lean away from the reader. "We cannot rule out that they simply prefer a calm voice," admitted project lead Dr. Sorrel Vance. The team cautioned against overinterpretation, noting that photosynthesizing remains the primary driver of growth and that iambic pentameter is not a substitute for watering.',
    ],
  },
  {
    section: 'Travel',
    title: 'Suspension Bridge Painted in Every Colour Becomes Instant Landmark',
    byline: 'By Tobias Wrenfield',
    paragraphs: [
      'The pedestrian suspension bridge spanning the Marrowford gorge was due for a fresh coat of paint, and the town council could not agree on a colour. After a public consultation produced two hundred and six suggestions, the council took the only reasonable decision available and approved all of them at once.',
      'The result is a dazzling striped walkway that photographers now travel hundreds of miles to visit. Each cable, plank and handrail bears a different hue, including a shade officially named "Tuesday Afternoon." Maintenance crews carry a forty-page colour guide. Local schoolchildren have memorised the sequence and recite it during walks across the gorge.',
    ],
  },
  {
    section: 'Technology',
    title: 'Robot Vacuum Escapes Apartment, Found Cleaning the Town Square',
    byline: 'By Priya Venkataraman',
    paragraphs: [
      'A robot vacuum cleaner that slipped out of an open front door on Monday was discovered six hours later methodically cleaning the paving stones of the central town square, apparently having mapped the entire route along three streets and a pedestrian crossing without incident or complaint.',
      'Its owner, graphic designer Felix Hartigan, said he had no idea the device was so ambitious. Shopkeepers praised the machine for its diligence and dedication. The council has since asked whether it might be available on weekends. Hartigan says he is considering the offer but worries the vacuum may now consider his apartment beneath its newly elevated professional standards.',
    ],
  },
  {
    section: 'Culture',
    title: 'Orchestra Performs Entire Symphony Using Kitchen Utensils',
    byline: 'By Imogen Stroud',
    paragraphs: [
      'The Harbourside Philharmonic swapped violins for whisks and timpani for saucepans on Friday evening, performing a full four-movement symphony composed entirely for kitchen equipment. The sold-out audience heard colanders, cheese graters, rolling pins and a particularly expressive set of measuring spoons.',
      'Conductor Valentina Moss led the ensemble with a wooden spoon in place of a baton. "Every kitchen is secretly a concert hall," she said afterwards. The slow movement, scored for two kettles approaching the boil, drew a standing ovation that lasted nearly five minutes. A recording will be released next month alongside a companion cookbook.',
    ],
  },
  {
    section: 'Weather',
    title: 'Hailstones Shaped Like Perfect Cubes Puzzle Local Residents',
    byline: 'By Hamish Drummond',
    paragraphs: [
      'Residents of Upper Dribbling woke on Thursday to find their lawns scattered with hailstones that appeared to be almost perfectly cubic, as if someone had emptied a giant ice tray from above. Several households collected samples in freezers, and one enterprising teenager started selling them for lemonade at a premium price.',
      'Atmospheric physicist Dr. Nimbus Okafor called the event intriguing but not supernatural. "Under unusual wind shear, crystals can grow along surprisingly regular faces," she explained, before conceding that she had never seen corners quite so tidy. The weather service has added the term "geometric hail" to its glossary, pending further investigation.',
    ],
  },
  {
    section: 'Food',
    title: 'Chef Invents Soup That Changes Flavour With Every Spoonful',
    byline: 'By Rosalind Fairweather',
    paragraphs: [
      'Diners at a small bistro on Copperwell Lane have been queuing around the block for a chilled soup that its creator claims shifts flavour from spoonful to spoonful. The first taste is tomato, the second becomes cucumber, and by the bottom of the bowl many guests insist they can detect a faint hint of strawberry.',
      'Chef Aurelio Fenwick refuses to reveal his method beyond describing careful layering and "a respectful relationship with gravity." Soup scientists from the university have requested a sample for analysis. Fenwick has politely declined, saying that some incomprehensibilities should remain on the menu rather than appearing in a laboratory report.',
    ],
  },
  {
    section: 'Home & Garden',
    title: 'Neighbours Compete to Grow the Largest Office Cactus',
    byline: 'By Marigold Penhallow',
    paragraphs: [
      'A friendly rivalry between two adjoining offices on the industrial estate has escalated into a full-scale cactus arms race. What began with a pair of modest desk succulents has grown into a contest involving fertiliser schedules, carefully angled mirrors and, according to one witness, a motivational speech delivered every morning at nine.',
      'The current leader, a barrel cactus named Spike, measures just over a metre tall and requires its own desk. Its rival, Prickles, is shorter but flowering. Both offices have refused to discuss tactics. Facilities management has asked that any future specimens remain below ceiling height and that the motivational speeches be kept to a reasonable volume.',
    ],
  },
  {
    section: 'Sport',
    title: 'Pigeon Loft Unveils Training Regime Inspired by Opera',
    byline: 'By Rupert Calloway-Finch',
    paragraphs: [
      'A racing pigeon loft in the hill country has adopted an unconventional training programme in which birds are played classical opera before every flight. Owner Barnaby Thistlewood believes the soaring arias encourage his birds to fly higher and with greater determination, and he points to an improved season as evidence of success.',
      'Rival fanciers remain sceptical, suggesting the improvement is due to a new seed blend. Thistlewood is unbothered. "My birds prefer the dramatic finales," he said, gesturing towards a gramophone mounted on the loft wall. Several pigeons were observed bobbing their heads in time with the music, though experts caution that pigeons bob their heads regardless.',
    ],
  },
  {
    section: 'Science',
    title: 'Study Finds Most Socks Are Lost on Wednesdays',
    byline: 'By Dr. Clementine Achebe',
    paragraphs: [
      'A comprehensive survey of laundry habits across four thousand households has identified Wednesday as the day most likely to result in a missing sock. Researchers asked participants to log every wash, every pair and every orphaned singleton over the course of a year, producing what they call the largest sock dataset ever assembled.',
      'The reasons remain unclear. Hypotheses include midweek fatigue, rushed folding and, according to one footnote, a hitherto undocumented portal located behind the drum. Lead researcher Dr. Argyle Patel encourages people to wash socks on Saturdays instead. "Weekend laundry is calmer and more attentive," he said, holding up a single striped sock.',
    ],
  },
  {
    section: 'Travel',
    title: 'Ancient Stone Bridge Discovered Hidden Beneath a Car Park',
    byline: 'By Tobias Wrenfield',
    paragraphs: [
      'Contractors resurfacing a supermarket car park in the riverside town of Stillmere uncovered something unexpected last month: a beautifully preserved medieval stone bridge, buried beneath layers of tarmac, gravel and decades of forgotten parking tickets. Archaeologists believe the river once ran directly through what is now the trolley bay.',
      'The supermarket has agreed to rearrange its parking spaces around the find, and a viewing platform is planned. "It is extraordinary to think shoppers have been crossing a medieval river every week without realising," said site archaeologist Maud Ellery. Trolleys will now be returned via a gently sloping ramp that respects the historic stonework.',
    ],
  },
  {
    section: 'Technology',
    title: 'App That Translates Cat Meows Mostly Says "Food"',
    byline: 'By Priya Venkataraman',
    paragraphs: [
      'A highly anticipated smartphone application promising to translate feline vocalisations into plain language has been downloaded more than two million times in its first week. Early users report that the app works remarkably well, although nearly every translation so far has been some variation of the word "food."',
      'Developers insist the results are accurate. "We did not program the cats," said co-founder Leopold Whisker. A premium version, available by subscription, offers more nuanced translations such as "food, but sooner" and "food, but different." Dog owners have requested a canine edition, which the company says is in development and currently translates every bark as "hello."',
    ],
  },
  {
    section: 'Culture',
    title: 'Museum Opens Exhibition Dedicated Entirely to Lost Umbrellas',
    byline: 'By Imogen Stroud',
    paragraphs: [
      'The city museum has opened a new wing devoted to umbrellas left behind on trains, buses and park benches over the past century. The collection includes more than three thousand specimens, from elegant silk parasols to a battered golf umbrella patched together with what curators believe to be shoelaces and optimism.',
      'Each umbrella is displayed with a label describing where it was found and a speculative story about its owner. Curator Ottoline Gray says the exhibition is about memory and forgetfulness. Visitors have been encouraged to check whether their own lost umbrellas are on display, and three have already been tearfully reunited with them.',
    ],
  },
  {
    section: 'Weather',
    title: 'Fog So Thick That Village Holds Festival Inside It',
    byline: 'By Hamish Drummond',
    paragraphs: [
      'When a dense fog settled over the hillside village of Mistwhistle and refused to lift for nine consecutive days, residents decided to stop complaining and start celebrating. The inaugural Fog Festival featured lantern processions, an echo competition and a treasure hunt in which nobody could see more than three metres ahead.',
      'Mayor Philippa Hoare described the event as a resounding success, despite briefly losing her way to the main stage. "The fog brings us closer together, mostly because we keep bumping into each other," she said. Organisers hope the fog returns next year, though forecasters have declined to make any commitments either way.',
    ],
  },
  {
    section: 'Food',
    title: 'Grandmother Wins Soup Championship for Twelfth Consecutive Year',
    byline: 'By Rosalind Fairweather',
    paragraphs: [
      'Ninety-one-year-old Winifred Porridge has claimed the county soup championship for the twelfth year in a row, retaining her title with a leek and potato recipe she claims has not changed since her own childhood. Competitors have tried everything from foraged mushrooms to exotic spices, but none have yet dethroned her.',
      'Asked for her secret, Mrs. Porridge offered only a wink and the words "patience and a heavy pan." Soup scientists attending the event took detailed notes. Her great-grandson, aged seven, has been named her official apprentice and was seen at the championship carefully stirring a small pot under close supervision.',
    ],
  },
  {
    section: 'Home & Garden',
    title: 'Moss Lawn Declared Best in Show at Horticultural Fair',
    byline: 'By Marigold Penhallow',
    paragraphs: [
      "In a decision that stunned traditional lawn enthusiasts, the judges at this year's horticultural fair awarded best in show to a garden carpeted entirely in moss. The velvety green surface, cultivated over eight years by retired postman Clifford Ambrose, requires no mowing, very little watering and absolutely no weekend arguments.",
      'Traditional lawn growers expressed shock but conceded the moss looked spectacular. "It is softer than any carpet I own," admitted one judge, who removed her shoes to test it. Ambrose says the secret is shade, patience and resisting the urge to tidy. Sales of moss starter kits at the fair sold out within the hour.',
    ],
  },
  {
    section: 'Sport',
    title: 'Snail Racing Championship Postponed Due to Excessive Enthusiasm',
    byline: 'By Rupert Calloway-Finch',
    paragraphs: [
      'The world snail racing championship was postponed for a second time this weekend after the competitors repeatedly abandoned the course to investigate a nearby lettuce patch. Officials had marked out the traditional thirteen-inch circular track with care, but the snails displayed what one referee called "an extraordinary lack of focus."',
      'The defending champion, a garden snail named Turbo Shelldon, was found asleep beneath a dock leaf. Race organisers have promised to move the event indoors and away from all vegetables. Spectators did not seem to mind the delay, and many stayed for a picnic, which several snails later attempted to join uninvited.',
    ],
  },
  {
    section: 'Science',
    title: 'Physicists Measure Exact Moment Toast Lands Butter-Side Down',
    byline: 'By Dr. Clementine Achebe',
    paragraphs: [
      'Using high-speed cameras and a specially built kitchen table, a team of physicists has measured the precise rotation responsible for toast landing butter-side down. The researchers dropped more than ten thousand slices from various heights and concluded that a standard table is almost exactly the wrong height for a breakfast-friendly landing.',
      'The paper recommends that households either raise their tables by roughly a metre or simply hold their toast more firmly. "We can explain the physics, but we cannot prevent the disappointment," said co-author Dr. Crispin Ogunleye. The remaining toast was donated to a local duck pond, where it was received with considerable enthusiasm.',
    ],
  },
  {
    section: 'Travel',
    title: 'Footbridge Made From Recycled Bicycles Opens to Cyclists Only',
    byline: 'By Tobias Wrenfield',
    paragraphs: [
      'A footbridge constructed entirely from more than two thousand recycled bicycle frames has opened over the canal in Spokeham, linking two cycle paths that previously ended on opposite banks. The structure gleams with chrome handlebars, painted crossbars and, as a decorative touch, several hundred bells mounted along the rails.',
      'Somewhat ironically, the bridge is open only to cyclists, since pedestrians kept stopping to ring the bells. The designer, sculptor Ingrid Pedalsen, described the project as a celebration of second chances. Each bicycle frame carries a small tag naming its previous owner, many of whom have returned to visit.',
    ],
  },
  {
    section: 'Technology',
    title: 'Self-Driving Lawnmower Wins Award for Artistic Stripes',
    byline: 'By Priya Venkataraman',
    paragraphs: [
      'An autonomous lawnmower built by a team of university students has won first prize at a national design show for the remarkable patterns it cuts into grass. Instead of plain straight stripes, the machine produces spirals, waves and occasional portraits of famous scientists visible from the upper windows of nearby houses.',
      'The students say the mower uses an algorithm originally intended for embroidery machines. Homeowners have begun commissioning designs for garden parties and anniversaries. "Last week it mowed a giant birthday cake," said team member Ravi Gallagher. The mower is now on tour, cutting patterns into public parks with the permission of grateful councils.',
    ],
  },
  {
    section: 'Culture',
    title: 'Street Musician Plays Only Songs About Bridges, Gains Following',
    byline: 'By Imogen Stroud',
    paragraphs: [
      'For seven years, accordionist Lucius Fairbanks has performed on the same riverside corner, playing exclusively songs about bridges. His repertoire includes folk ballads, sea shanties and several originals, among them a lengthy instrumental piece inspired by a drawbridge that once refused to close.',
      'His dedication has earned him a loyal following of commuters, engineers and at least one structural surveyor who visits every lunchtime. "Bridges connect people, and so does music," Fairbanks said, adjusting his straps. He is currently composing a song about a famous bridge that goes nowhere, which he describes as the most honest piece he has ever written.',
    ],
  },
  {
    section: 'Weather',
    title: 'Rainbow Lasts Entire Afternoon, Citizens Request Encore',
    byline: 'By Hamish Drummond',
    paragraphs: [
      'A double rainbow appeared over the city of Brightmoor shortly after lunch on Sunday and remained visible for more than four hours, delighting residents who abandoned errands to sit on rooftops and balconies. Meteorologists attributed the phenomenon to a slow-moving band of drizzle and unusually cooperative sunshine.',
      'Within hours, a petition requesting an encore had gathered thirty thousand signatures. The weather service responded that it does not take requests but appreciated the enthusiasm. Several couples reportedly became engaged beneath the rainbow. One local florist sold out of every colourful bouquet in stock and described the day as the best Sunday of her life.',
    ],
  },
  {
    section: 'Food',
    title: 'Café Introduces Sandwich Assembled by Committee',
    byline: 'By Rosalind Fairweather',
    paragraphs: [
      'A café near the town hall has unveiled what it calls the most democratic sandwich in history, with each ingredient chosen by a public vote held over three weeks. The final creation includes roasted peppers, smoked cheese, pickled beetroot, a single fried egg and a sprinkling of crushed crisps added at the last moment.',
      'Owner Dorothea Pemberton admits she had doubts. "On paper it should not work," she said. "In practice it is magnificent." The committee sandwich now outsells every other item on the menu. A second vote is planned to choose a soup to accompany it, and campaigning among regular customers has already become surprisingly intense.',
    ],
  },
  {
    section: 'Home & Garden',
    title: 'Sunflower Grows Through Shed Roof, Owner Builds Around It',
    byline: 'By Marigold Penhallow',
    paragraphs: [
      'When a self-seeded sunflower pushed through a gap in the roof of his garden shed, pensioner Algernon Pettigrew faced a difficult choice. Rather than cut it down, he decided to cut a neat circular hole in the roof and install a small rubber collar so the flower could continue growing without letting the rain in.',
      'The sunflower has now reached nearly four metres and is visible from the end of the street. Children walking to school wave at it every morning. Pettigrew says the shed has become a minor tourist attraction. "It is photosynthesizing above its station," he joked, adding that he plans to save the seeds and share them with neighbours.',
    ],
  },
  {
    section: 'Sport',
    title: 'Competitive Pigeon Racer Retires to Become Motivational Speaker',
    byline: 'By Rupert Calloway-Finch',
    paragraphs: [
      'After a celebrated career that included three national titles and one unforgettable detour through a cathedral, veteran pigeon racer Hortense Featherstonehaugh has announced her retirement from competition. She now intends to travel the country giving motivational talks about perseverance, homing instincts and the importance of always knowing your way back.',
      'Her first lecture, titled "Find Your Loft," sold out in minutes. Attendees described the talk as inspiring, practical and occasionally interrupted by cooing from the pigeon she brought along for emotional support. Featherstonehaugh says she will continue breeding birds as a hobby but has no plans to return to the pressure of the starting basket.',
    ],
  },
  {
    section: 'Science',
    title: 'Chemists Develop Soup That Stays Exactly the Right Temperature',
    byline: 'By Dr. Clementine Achebe',
    paragraphs: [
      "A team of food chemists claims to have solved one of humanity's most persistent kitchen problems with a soup that remains at the perfect eating temperature for up to an hour. The secret lies in a harmless blend of starches that release heat slowly, combined with a specially shaped bowl inspired by thermos design.",
      'Testers praised the soup but noted it removed the pleasure of blowing on a spoonful. "There is something comforting about the struggle," said one volunteer. The researchers are now working on a version for porridge. Critics argue the invention erodes a cherished tradition, while supporters simply asked for a second bowl.',
    ],
  },
  {
    section: 'Travel',
    title: 'Rope Bridge Across Duck Pond Declared Too Charming to Remove',
    byline: 'By Tobias Wrenfield',
    paragraphs: [
      'A temporary rope bridge built across the village duck pond for a scouting weekend has been granted permanent status after residents campaigned to keep it. The wobbly structure, assembled from donated rope and reclaimed planks, spans just eight metres but has become a cherished spot for picnics, proposals and long conversations about nothing in particular.',
      'Council inspectors declared the bridge perfectly safe, if slightly bouncy. The resident ducks appear to approve and often gather beneath it. Scout leader Godfrey Tanner is delighted. "We meant to take it down on Sunday," he said. "Then everyone looked so happy that we simply could not bring ourselves to untie a single knot."',
    ],
  },
  {
    section: 'Technology',
    title: 'Smart Doorbell Develops Habit of Greeting Passing Squirrels',
    byline: 'By Priya Venkataraman',
    paragraphs: [
      'Homeowners on Larkspur Avenue have noticed that a newly installed smart doorbell has begun cheerfully announcing the arrival of squirrels, pigeons and the occasional hedgehog. The device, which uses facial recognition to welcome visitors by name, appears to have assigned names to the local wildlife without being asked.',
      'The most frequent visitor, a grey squirrel the doorbell calls "Gordon," has now been greeted more than four hundred times. Owner Celestine Marsh says she has grown fond of the announcements. "It makes the house feel busy," she said. The manufacturer has offered a software patch, but Marsh has declined, fearing Gordon would feel ignored.',
    ],
  },
  {
    section: 'Culture',
    title: 'Poetry Slam for Houseplants Draws Record Attendance',
    byline: 'By Imogen Stroud',
    paragraphs: [
      'The first poetry slam performed exclusively for an audience of houseplants took place at a garden centre on Saturday night. Poets read to rows of ferns, peace lilies and an attentive monstera while human spectators watched from the back, holding their applause until each plant had been given time to absorb the verse.',
      'Organiser Cressida Bloom said the event was inspired by recent research into poetry and plant growth. "We wanted to give the plants a proper night out," she said. The winning poem, a heartfelt ode to photosynthesizing in winter light, earned a rustle of approval from the ferns. Tickets for next month have already sold out.',
    ],
  },
  {
    section: 'Weather',
    title: "Gentle Breeze Rearranges Entire Neighbourhood's Garden Furniture",
    byline: 'By Hamish Drummond',
    paragraphs: [
      'A breeze described by forecasters as "light to moderate" swept through the suburb of Willowmere on Monday afternoon and somehow rearranged almost every piece of garden furniture on three streets. Residents returned home to find deck chairs facing new directions, parasols in neighbouring gardens and a hammock wrapped neatly around a lamppost.',
      'No damage was reported, and several residents admitted the new arrangements were an improvement. "My bench now faces the sunset," said one homeowner. The weather service is investigating how such a mild wind achieved so much. Meanwhile, neighbours spent a pleasant evening returning furniture and discovering they had never actually been formally introduced.',
    ],
  },
  {
    section: 'Food',
    title: 'Giant Pot of Soup Feeds Entire Town at Harvest Celebration',
    byline: 'By Rosalind Fairweather',
    paragraphs: [
      'The town of Brackenfold set a regional record on Saturday by cooking a single pot of vegetable soup large enough to feed every one of its four thousand residents. The enormous cauldron, borrowed from a brewery and scrubbed for three days, was stirred with a wooden paddle by volunteers working in fifteen-minute shifts.',
      'Ingredients were donated by local farms and allotment holders, resulting in a soup that one attendee described as "every vegetable at once." Soup scientists measured the temperature hourly and confirmed it was excellent. Leftovers were frozen in jars and distributed the following day, when, as predicted by research, the soup tasted even better.',
    ],
  },
  {
    section: 'Technology',
    title: 'Web Page Escapes Its Canvas, Found Rearranging Itself in Lobby',
    byline: 'By Theo Brannigan',
    paragraphs: [
      'Developers at a small design studio were startled on Wednesday when a news page they had drawn into a canvas appeared to have opinions about its own layout. Every headline, button and caption remained a real element, so the page could be pushed, stacked and shuffled, and by mid-afternoon an intern had arranged the sports section into a neat pyramid.',
      'The studio insists no pages were harmed. "It is just HTML that happens to be on the GPU," said lead engineer Ottoline Marsh. "Screen readers still read it, the links still work, and the find bar still finds the word pigeon, wherever the pigeon story has been pushed to." The pyramid has since been declared a permanent installation.',
    ],
  },
  {
    section: 'Technology',
    title: 'Grandmother Masters Forty Browser Tabs, Calls It Light Reading',
    byline: 'By Imogen Ashdown',
    paragraphs: [
      'Eighty-one-year-old Winifred Copperfield has become an unlikely celebrity in her village after a visiting nephew discovered she keeps forty-two browser tabs open at all times and knows exactly what is in every one of them. Her collection includes eleven knitting patterns, nine weather forecasts for places she has never visited and a very long article about the history of spoons.',
      '"People close tabs far too quickly," she said, pouring tea. "Each one is a little room you can go back to." She groups them by colour and refuses to bookmark anything on principle. Her nephew has offered to buy her a second monitor, which she has accepted on the condition that it comes with a tea coaster.',
    ],
  },
  {
    section: 'Science',
    title: 'Researchers Teach Houseplant to Water Itself Using a Spreadsheet',
    byline: 'By Desmond Achterberg',
    paragraphs: [
      'A team of graduate students has wired a moisture sensor to an ordinary spider plant and connected it to a shared spreadsheet, which now waters the plant automatically whenever a cell turns red. The project began as a joke during a long winter and has since grown into a small department obsession, with a live chart projected onto the common room wall.',
      'The plant, named Cellular, has thrived under the new regime and produced eleven baby plants, each with its own row. "The hardest part was stopping people from editing the formulas," said project lead Priya Venkataraman. "Someone set the target moisture to one hundred percent on a Friday, and on Monday Cellular was essentially living in a pond." Access is now read-only.',
    ],
  },
  {
    section: 'Sport',
    title: 'Office Chair Racing League Announces Strict New Wheel Regulations',
    byline: 'By Barnaby Quist',
    paragraphs: [
      'The amateur office chair racing league has published its long-awaited rule book after a season marred by disputes over aftermarket castors and suspiciously well-oiled swivels. From next month every chair must be inspected before the race, armrests must remain attached, and no rider may push off from a filing cabinet more than once per lap.',
      'League commissioner Hyacinth Dobbs said the changes were overdue. "Last season a competitor fitted rollerblade wheels and took the corridor corner at a speed we can only describe as unprofessional," she said. Riders have welcomed the clarity, though several have complained that the new mandatory helmet makes it hard to see the finishing line, which is a strip of masking tape near the photocopier.',
    ],
  },
  {
    section: 'Travel',
    title: 'Night Train Passengers Vote to Keep Sleeping Past Their Stop',
    byline: 'By Lucinda Farrow',
    paragraphs: [
      'Passengers on a slow overnight sleeper service have voted, in an informal poll conducted by the dining car attendant, to stay aboard to the end of the line after the train arrived so smoothly that nobody wanted to wake up. The train reached its terminus at dawn with every berth still occupied and a gentle chorus of snoring audible from the platform.',
      'The operator has responded by offering an optional extra hour in the sidings, with coffee served to the compartments and the blinds left closed. "We take it as the highest compliment," said conductor Ambrose Kettering. "If people refuse to leave, the beds are doing their job." A waiting list for the sleepy extension has already reached three weeks.',
    ],
  },
  {
    section: 'Culture',
    title: 'Library Introduces Silent Disco for People Who Love Quiet',
    byline: 'By Perpetua Holm',
    paragraphs: [
      'A city library has launched a monthly silent disco in its reading room, where guests wear wireless headphones and dance between the shelves without making a sound. The event was proposed by a librarian who noticed that patrons often tapped their feet while reading and thought the energy deserved an outlet that would not disturb anyone.',
      'The first night attracted more than two hundred dancers, several of whom borrowed books on the way out. Organisers offer three channels: classical, pop and a third that plays only the sound of pages turning, which proved unexpectedly popular. "It is the most well-behaved party I have ever seen," said head librarian Cornelius Bray. "Nobody spilled anything, and every book went back on the right shelf."',
    ],
  },
  {
    section: 'Home & Garden',
    title: 'Neighbourhood Hedge Trimmed Into Perfect Replica of a Loading Spinner',
    byline: 'By Gideon Thistlewood',
    paragraphs: [
      'Residents of a quiet cul-de-sac have been left mesmerised by a privet hedge that one homeowner has spent two summers sculpting into the shape of a circular loading spinner. The topiary features twelve evenly spaced leafy segments, and thanks to some clever pruning the shading makes it look as though the circle is slowly turning.',
      'Its creator, retired software tester Mildred Oakes, says the idea came from years of watching pages load. "I wanted something in the garden that reminded me to be patient," she explained, clippers in hand. Passing drivers frequently slow down to stare. One child reportedly waited several minutes in front of the hedge, hoping something would finally finish downloading.',
    ],
  },
  {
    section: 'Weather',
    title: 'Forecasters Introduce New Category for Weather That Cannot Decide',
    byline: 'By Horatio Pellingham',
    paragraphs: [
      'The regional weather service has added a new symbol to its daily forecast: a small cloud wearing a raincoat and sunglasses at the same time. It will be used on days when sunshine, drizzle, wind and brief hail are all expected within the same hour, a pattern meteorologists say has become so common that it needed its own name.',
      'Chief forecaster Octavia Lumley said the category was requested by the public. "People told us that partly cloudy did not capture the experience of being rained on in bright sunshine while holding an ice cream," she said. The new forecast advises residents to carry an umbrella, sun cream and a scarf, and to remain flexible in both clothing and attitude.',
    ],
  },
  {
    section: 'Food',
    title: 'Café Serves Coffee in Cups Shaped Like Tiny Web Browsers',
    byline: 'By Clementine Rourke',
    paragraphs: [
      'A café near the university has become a pilgrimage site for developers after it began serving its flat whites in ceramic cups shaped like miniature browser windows, complete with three coloured dots and a glazed address bar. The latte art on top is drawn to look like a page that is still loading, which the baristas insist is a joke and not a comment on the wifi.',
      'Owner Bartholomew Sneed says the idea started as a single prototype cup for a regular. "Now we have people asking for a refresh," he said. The café plans to add a tab-shaped biscuit next month. Regulars report that the cups are surprisingly comfortable to hold, though the address bar makes stirring slightly harder than expected.',
    ],
  },
  {
    section: 'Science',
    title: 'Astronomers Spot Galaxy That Appears to Be Shaped Like a Cursor',
    byline: 'By Ingrid Valtersen',
    paragraphs: [
      'An international team of astronomers has published images of a distant galaxy whose dust lanes form an unmistakable arrow, tilted at exactly the angle of a computer mouse pointer. The object, catalogued with a long number but already nicknamed the Pointer Galaxy, lies roughly two hundred million light years away and is pointing, as far as anyone can tell, at nothing in particular.',
      'Lead author Dr. Tobias Wren said the resemblance was entirely coincidental but admitted the team had tried double-clicking on the image. "Nothing happened, which is honestly a relief," he said. The paper has become the most downloaded in the observatory\'s history, largely thanks to a version with a tiny hourglass added beside it.',
    ],
  },
  {
    section: 'Culture',
    title: 'Town Choir Performs Entire Concert Using Only Notification Sounds',
    byline: 'By Seraphina Dunmore',
    paragraphs: [
      'A community choir has stunned audiences with a programme performed entirely by singing the chimes, pings and swooshes of everyday devices. The concert opened with a stirring arrangement of the new message sound, built to a crescendo of calendar reminders, and closed with a delicate solo rendition of a battery that is almost empty.',
      'Choir director Lionel Abernathy said rehearsals had been challenging. "Every time we practised, half the audience in the hall reached for their pockets," he said. The choir now asks the audience to switch phones to silent so that the music cannot be confused with reality. A recording will be released later this year, available as a set of very short ringtones.',
    ],
  },
  {
    section: 'Travel',
    title: 'Island Ferry Adds Reading Corner, Passengers Miss Their Port',
    byline: 'By Cosmo Ridgeway',
    paragraphs: [
      'A small island ferry has installed a cosy reading corner with armchairs, blankets and a shelf of donated paperbacks, and has since had to add a loud bell before each arrival. On the first week alone, eleven passengers were so absorbed in their books that they sailed straight past their destination and back again, several of them twice.',
      'Captain Rosalind Mercer has taken the problem in her stride. "We now announce each stop by reading the last line of a chapter over the speakers," she said. "People look up to hear how it ends, and then they notice where they are." The reading corner remains open, and the ferry has started lending books that can be returned on any crossing.',
    ],
  },
];
