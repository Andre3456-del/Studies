'use strict';
// Public pages anyone can read without logging in: About, How it works, Contact, and the Study Guides.
// They give visitors (and Google) real, original reading material, and they are the only pages that carry the AdSense snippet
// besides the home page. Nothing here needs a login, so nothing here touches private data.

const UPDATED = 'November 2026';

const GUIDES = [
  {
    slug: 'how-to-study-for-university-exams-in-nigeria',
    title: 'How to Study for University Exams in Nigeria',
    summary: 'A practical routine for the weeks before exams: what to read first, how to revise, and how to avoid the all-night panic.',
    body: `
<p>Most students who struggle in exams do not lack brains. They start late, read everything the same way, and never test themselves. This guide gives you a routine you can start today, whether exams are six weeks away or only two.</p>
<h2>1. Start from the syllabus, not from the textbook</h2>
<p>Write down every course you will write, with its course code, unit load and exam date. A 3-unit course affects your CGPA three times as much as a 1-unit course, so it deserves more of your time. For each course, list the topics your lecturer actually taught. Your lecture notes, handouts and the course outline are a better guide than a thick textbook you will never finish.</p>
<h2>2. Work backwards from the exam date</h2>
<p>Count the days you have left. Give the hardest and highest-unit courses the most days, and put them early in your plan. Leave the last two days before each paper for revision only, with no new topics. If two exams fall close together, revise the later one first, because you will have less time to recover between them.</p>
<h2>3. Read actively, not passively</h2>
<p>Reading a page three times feels productive but teaches very little. Try this instead: read one section, close the book, and say or write what it said in your own words. If you cannot, read it again. Turn headings into questions ("What are the causes of inflation?") and answer them from memory. This is slower at first, but you remember far more.</p>
<h2>4. Use short, focused sessions</h2>
<p>Study for 40 to 50 minutes, then rest for 10. During the session keep your phone away, in another room if you can. Four focused sessions in a day beat ten hours with a phone beside you. Choose the time of day when you think best, which for many students is early morning, and give that time to your hardest course.</p>
<h2>5. Practise with past questions</h2>
<p>Lecturers repeat styles, and often topics. After you have covered a topic, answer past questions on it without looking at your notes, then mark yourself honestly. Our guide on <a href="/guides/how-to-use-past-questions-the-right-way">using past questions the right way</a> explains how to do this well.</p>
<h2>6. Study in a group, carefully</h2>
<p>A good study group is two to four people who have each prepared before they meet. Take turns explaining a topic to the others. Teaching exposes the gaps in your own understanding faster than anything else. A group that mostly chats should be left.</p>
<h2>7. Look after your body</h2>
<p>Sleep, food and water are part of your revision plan. Staying up all night before a paper usually costs you more marks than it earns. Sleep at least six hours, eat something before you go in, and avoid last-minute cramming of new material on the morning itself. Instead, read your own summary sheet once.</p>
<h2>8. On the day of the exam</h2>
<ul>
<li>Check your venue and time the day before, and arrive early.</li>
<li>Read the whole paper and the instructions first.</li>
<li>Start with the question you know best, to settle your nerves.</li>
<li>Share your time by marks: do not spend forty minutes on a question worth ten.</li>
<li>If you are stuck, write what you do know. Partial answers earn marks, blank spaces earn none.</li>
</ul>
<h2>Final word</h2>
<p>Good results come from a steady routine, not from heroic last-night effort. Plan early, test yourself often, and protect your sleep. If you keep this up, the exam week will feel like a review of things you already know.</p>`
  },
  {
    slug: 'how-to-plan-your-semester-with-a-timetable',
    title: 'How to Plan Your Semester with a Timetable',
    summary: 'Turn the lecture timetable and the school calendar into a weekly plan that leaves room for study, rest and life.',
    body: `
<p>A semester in a Nigerian university is short. With lectures, tests, assignments and the examination period, the weeks pass quickly, and many students only notice how much is left to cover when exams are already close. A simple weekly plan fixes this. Here is how to build one in about half an hour.</p>
<h2>Step 1: Collect the facts</h2>
<p>Get these four things in one place:</p>
<ul>
<li>Your lecture timetable, with the day, time and venue for every course.</li>
<li>The school calendar: resumption date, mid-semester break, test weeks and the start of examinations.</li>
<li>Your course list with the unit load of each course.</li>
<li>Deadlines you already know about: assignments, practicals, group projects and reports.</li>
</ul>
<h2>Step 2: Read your lecture timetable properly</h2>
<p>Timetables are usually grids of days and hours. Note which courses you have back to back, which days are heavy, and which days have gaps. The gaps are your study slots. A free hour between two lectures is the best time to read the notes you just took, while they are still fresh, rather than walking around waiting for the next class.</p>
<h2>Step 3: Block your week</h2>
<p>Draw a seven-day grid. Fill in this order:</p>
<ol>
<li>Lectures and practicals, which are fixed.</li>
<li>Sleep, meals, prayer or worship, and travel time.</li>
<li>Study blocks: for every hour of lecture in a course, plan about an hour of your own study for it each week.</li>
<li>Rest and activities you enjoy, so the plan is one you can keep.</li>
</ol>
<h2>Step 4: Give every course a regular slot</h2>
<p>Repeating a slot makes studying a habit. For example, Tuesday and Thursday evenings for one course, and Wednesday and Saturday for another. When a slot is already decided, you do not waste energy each day deciding what to read.</p>
<h2>Step 5: Plan backwards from tests and exams</h2>
<p>Mark the test dates and the first exam date on the plan. Four weeks before exams, switch from first-time reading to revision. At that point, finish any topics you have not yet covered, and begin practising with past questions.</p>
<h2>Step 6: Review every Sunday</h2>
<p>Spend ten minutes each week looking at what you planned and what you did. Move what you missed into the coming week, and be honest about what is too much. A plan that you adjust weekly will survive strikes, delays and sudden tests far better than a perfect plan you abandon in week three.</p>
<h2>Common mistakes</h2>
<ul>
<li>Planning every minute of the day. Leave gaps; things always take longer than you think.</li>
<li>Ignoring small courses. Their units add up in your CGPA.</li>
<li>Skipping the review. Without it, the plan becomes a list of good intentions.</li>
</ul>
<h2>A short example</h2>
<p>Suppose you have a 3-unit course on Monday and Wednesday mornings. Add one evening block on Monday to rewrite the day's notes, and one on Thursday to attempt questions on that week's topics. That is only about three hours a week, but by exam time you will have gone over each topic at least twice.</p>
<p>Keep your plan somewhere you will see it every day, for instance as a photo on your phone or on a page above your desk.</p>`
  },
  {
    slug: 'how-to-use-past-questions-the-right-way',
    title: 'How to Use Past Questions the Right Way',
    summary: 'Past questions are one of the best study tools there is, if you use them to find your weak points instead of to guess the exam.',
    body: `
<p>Every student hears "go and read past questions". Not everyone knows how. Some memorise the answers, are surprised when the lecturer changes the wording, and lose marks. Used properly, past questions teach you what examiners look for and where you are weak.</p>
<h2>What past questions can and cannot do</h2>
<p>They show you the style of the exam: how many sections, how many questions to answer, whether it is essay, short answer or objective, and how marks are shared. They also show which topics lecturers like to return to. What they cannot do is tell you exactly what will come. Lecturers change, syllabuses change, and a topic that appeared for five years may not appear this year. Treat past questions as practice, not as a prediction.</p>
<h2>Step 1: Learn the topic first</h2>
<p>Do not start with past questions on a topic you have not studied. Read and understand the topic, then use the questions to test yourself on it.</p>
<h2>Step 2: Answer under exam conditions</h2>
<p>Pick a past paper. Set a timer for the real exam time. Close your notes and answer in writing, as you would in the hall. This reveals problems that silent reading hides: slow handwriting, poor time sharing, and topics you thought you understood.</p>
<h2>Step 3: Mark yourself honestly</h2>
<p>Compare your answers with your notes or a trusted source. Give yourself marks the way the examiner would. For each mistake, write one line saying why it happened: a gap in knowledge, a misread question, or a careless slip. After a few papers you will see your pattern.</p>
<h2>Step 4: Fix the gaps</h2>
<p>Go back to the notes for the topics where you lost marks, restudy them, and then try a fresh question on the same topic a few days later.</p>
<h2>Step 5: Look for patterns across years</h2>
<p>List which topics appear often. Make sure you know those very well, but do not drop the rest. Keep in mind that questions on the same topic are often asked in a different way, for example as a calculation one year and as an explanation the next.</p>
<h2>For objective and CBT papers</h2>
<p>Practise reading each option carefully and eliminating wrong answers before choosing. If you can say why each wrong option is wrong, you understand the topic. Our guide on <a href="/guides/how-to-prepare-for-cbt-exams">preparing for CBT exams</a> covers the technical side.</p>
<h2>Things to avoid</h2>
<ul>
<li>Memorising answers word for word.</li>
<li>Using only the newest year, or only the oldest.</li>
<li>Treating a paper as done once you have read the answers. You have only learnt something once you can produce the answer yourself.</li>
<li>Relying on past questions alone. They support your reading; they do not replace it.</li>
</ul>
<p>Used this way, a few papers per course will tell you more about your readiness than weeks of unfocused reading.</p>`
  },
  {
    slug: 'how-to-calculate-your-cgpa',
    title: 'How to Calculate Your GPA and CGPA (5-Point Scale)',
    summary: 'A clear explanation of grade points, credit units, GPA and CGPA, with a worked example you can copy.',
    body: `
<p>Most Nigerian universities use a five-point grading scale. If you understand how your GPA and CGPA are worked out, you can see exactly how much one course affects your result, and you can plan what you need to reach the class of degree you want. This guide shows the method with an example.</p>
<p><b>Note:</b> grading bands differ slightly between universities. Use the table in your own school's handbook if it is different from the one below.</p>
<h2>A common grading table</h2>
<table class="gtab"><thead><tr><th>Score</th><th>Grade</th><th>Grade point</th></tr></thead><tbody>
<tr><td>70 - 100</td><td>A</td><td>5</td></tr>
<tr><td>60 - 69</td><td>B</td><td>4</td></tr>
<tr><td>50 - 59</td><td>C</td><td>3</td></tr>
<tr><td>45 - 49</td><td>D</td><td>2</td></tr>
<tr><td>40 - 44</td><td>E</td><td>1</td></tr>
<tr><td>0 - 39</td><td>F</td><td>0</td></tr>
</tbody></table>
<h2>Key terms</h2>
<ul>
<li><b>Credit unit (or unit load):</b> how heavy a course is, usually 1 to 4 or more.</li>
<li><b>Grade point (GP):</b> the number for your grade, from the table.</li>
<li><b>Quality point (QP):</b> credit unit multiplied by grade point.</li>
<li><b>GPA:</b> your average for one semester.</li>
<li><b>CGPA:</b> your cumulative average across all the semesters so far.</li>
</ul>
<h2>The formula</h2>
<p><b>GPA = total quality points &divide; total credit units</b> for that semester.</p>
<p><b>CGPA = total quality points of all semesters &divide; total credit units of all semesters.</b></p>
<h2>Worked example</h2>
<p>Suppose in one semester you take five courses:</p>
<table class="gtab"><thead><tr><th>Course</th><th>Units</th><th>Score</th><th>Grade point</th><th>Quality points</th></tr></thead><tbody>
<tr><td>Course 1</td><td>3</td><td>72 (A)</td><td>5</td><td>15</td></tr>
<tr><td>Course 2</td><td>3</td><td>64 (B)</td><td>4</td><td>12</td></tr>
<tr><td>Course 3</td><td>2</td><td>55 (C)</td><td>3</td><td>6</td></tr>
<tr><td>Course 4</td><td>3</td><td>48 (D)</td><td>2</td><td>6</td></tr>
<tr><td>Course 5</td><td>1</td><td>81 (A)</td><td>5</td><td>5</td></tr>
</tbody></table>
<p>Total units = 3 + 3 + 2 + 3 + 1 = 12. Total quality points = 15 + 12 + 6 + 6 + 5 = 44. GPA = 44 &divide; 12 = <b>3.67</b>.</p>
<p>If your first semester was 3.67 over 12 units (44 points), and the next semester you earn 50 points over 14 units, your CGPA is (44 + 50) &divide; (12 + 14) = 94 &divide; 26 = <b>3.62</b>.</p>
<h2>Classes of degree</h2>
<p>A common scale is: First Class, 4.50 to 5.00; Second Class Upper, 3.50 to 4.49; Second Class Lower, 2.40 to 3.49; Third Class, 1.50 to 2.39; Pass, 1.00 to 1.49. Again, check your own school's regulations.</p>
<h2>Using it to plan</h2>
<p>Because high-unit courses carry more quality points, an A in a 4-unit course lifts your average more than an A in a 1-unit course. Equally, a failed 4-unit course hurts more. When you must choose where to spend your time, put it where the units are. Also remember that a carry-over, once passed, still counts in your records, so avoid failing in the first place by starting early.</p>
<h2>Do the sum before results</h2>
<p>Try working out the CGPA you need next semester to reach your target. Take your current total quality points and units, add the units you will take next, and see what total points you need. Seeing the number makes the goal concrete.</p>`
  },
  {
    slug: 'how-to-write-a-good-project-proposal',
    title: 'How to Write a Good Final-Year Project Proposal',
    summary: 'The usual parts of a proposal, how to choose a topic your supervisor will approve, and the mistakes that get proposals sent back.',
    body: `
<p>Your final-year project begins with a proposal. A clear proposal gets approved faster and makes the rest of the work easier, because it forces you to decide what you will study, why, and how. Formats vary between departments, so always check your department's template first. The parts below are common to most.</p>
<h2>Choosing a topic</h2>
<p>A good topic is narrow enough to finish in the time you have, and interesting enough that you will not hate it by month three. Start from a problem you have seen: in your department, your community or an industry you know. "Effects of social media on students" is too broad. "Effect of WhatsApp study groups on the performance of 200-level Accounting students at a named university" can actually be studied.</p>
<p>Before you commit, ask three questions. Is there enough existing literature? Can I collect the data I need? Does my supervisor know enough about the area to guide me?</p>
<h2>The usual parts</h2>
<ol>
<li><b>Title.</b> Specific and honest. It should tell the reader the subject, the group studied and the place.</li>
<li><b>Background of the study.</b> A short explanation of the area and why it matters.</li>
<li><b>Statement of the problem.</b> The gap or difficulty your study addresses. This is the heart of the proposal: if the problem is not clear, everything after it is weak.</li>
<li><b>Aim and objectives.</b> The aim is the overall purpose; the objectives are three to five specific, measurable steps, each starting with a verb such as "to determine" or "to examine".</li>
<li><b>Research questions or hypotheses.</b> They should match your objectives one for one.</li>
<li><b>Significance of the study.</b> Who benefits, and how.</li>
<li><b>Scope and limitations.</b> What you will cover and what you will not.</li>
<li><b>Literature review (brief).</b> What others have found, with real, correctly cited sources.</li>
<li><b>Methodology.</b> The design, the population and sample, how you will collect data and how you will analyse it.</li>
<li><b>Timeline and references.</b></li>
</ol>
<h2>Writing tips</h2>
<ul>
<li>Use plain, direct sentences. Long, decorated sentences hide weak ideas.</li>
<li>Make sure the objectives, questions and methods line up. A common mistake is an objective that the method cannot answer.</li>
<li>Cite only sources you have actually read, and keep a list as you go.</li>
<li>Write the work in your own words. Copying others is plagiarism and many schools check for it.</li>
</ul>
<h2>Why proposals are sent back</h2>
<ul>
<li>The topic is too wide or too common in your department.</li>
<li>The problem statement describes a topic, but not a problem.</li>
<li>The objectives are vague ("to know about...") and cannot be measured.</li>
<li>The sample is unrealistic, for example surveying 500 people with no way of reaching them.</li>
</ul>
<h2>Working with your supervisor</h2>
<p>Book meetings, bring a written draft, and send questions in advance. Take notes in each meeting and do what you agreed before the next one. Supervisors help most those who show steady progress, and they remember students who disappear for two months and return the week before the deadline.</p>`
  },
  {
    slug: 'how-to-prepare-for-cbt-exams',
    title: 'How to Prepare for Computer-Based Tests (CBT)',
    summary: 'What a CBT is like, how to practise for it, and how to manage the clock and your nerves on the day.',
    body: `
<p>Computer-based tests are now common in Nigerian universities and in national exams. You read the question on a screen, click your answer, and the system marks it. They save time for the school, but they feel different from paper exams. A little preparation takes the surprise away.</p>
<h2>Know the format before the day</h2>
<p>Find out how many questions there will be, how long you have, whether each question has the same marks, and whether wrong answers lose marks. Ask your department, or read the instructions you were given. Also check whether you can move back to earlier questions, because this changes how you should use your time.</p>
<h2>Practise on a screen</h2>
<p>Reading from a screen is tiring if you are not used to it. Practise with timed objective questions on your phone or a computer. Answer in the same time per question you will have in the real test. Many students find that they know the topic but run out of time simply because they read slowly on screen.</p>
<h2>Learn to read options carefully</h2>
<p>In objective questions, two options may look almost right. Read the question fully, then every option, before choosing. Words like "not", "except", "always" and "only" change the answer. Eliminate options you know are wrong first, then choose among those left.</p>
<h2>Manage your time</h2>
<ul>
<li>Divide the total time by the number of questions to get the time per question, and check your progress at the halfway point.</li>
<li>If you are stuck, mark the question (if the system allows) and move on. Return to it at the end.</li>
<li>Do not leave a question blank unless wrong answers are penalised. A guess has a chance of being right; a blank has none.</li>
<li>Keep the last few minutes to review the questions you marked.</li>
</ul>
<h2>Practical things on the day</h2>
<ul>
<li>Arrive early so you can find your seat and settle.</li>
<li>Bring everything required, such as your ID or exam card.</li>
<li>If the system freezes or the power fails, stay calm and call an invigilator immediately. Do not try to fix it yourself.</li>
<li>Before you submit, check that the system recorded your answers.</li>
</ul>
<h2>Calming your nerves</h2>
<p>Take a few slow breaths before you start. Read the first question without panic; if it is hard, move on and find an easier one to build confidence. A calm start usually leads to a better score than a rushed one.</p>
<h2>Keep studying the usual way</h2>
<p>A CBT tests the same knowledge as a paper exam. Use the habits in our guide to <a href="/guides/how-to-study-for-university-exams-in-nigeria">studying for university exams</a> and the practice method in <a href="/guides/how-to-use-past-questions-the-right-way">using past questions</a>. The screen is only a different way of answering.</p>`
  },
  {
    slug: 'siwes-industrial-training-guide',
    title: 'A Student Guide to SIWES (Industrial Training)',
    summary: 'What SIWES is, how to find a placement, what to record in your logbook, and how to get the most from it.',
    body: `
<p>The Students' Industrial Work Experience Scheme, usually called SIWES, is a compulsory programme in many Nigerian universities and polytechnics. It places students in workplaces so they can practise what they study in class. Your school's SIWES unit sets the details, so treat this guide as general advice and follow the rules in your own department.</p>
<h2>What SIWES is for</h2>
<p>Classroom learning gives you theory. A workplace shows you how the theory is used, how teams work, and what employers expect. Many students also leave SIWES with a better idea of the career they want, and sometimes with a job offer or a strong referee.</p>
<h2>Before you go</h2>
<ol>
<li>Attend the SIWES orientation. Collect and read the forms, the logbook and the dates.</li>
<li>Prepare a short CV and a clear request letter to organisations in your field.</li>
<li>Start looking early. Good placements fill quickly.</li>
<li>Confirm that your school accepts the organisation before you start.</li>
</ol>
<h2>Finding a placement</h2>
<p>Try organisations related to your course: engineering firms, hospitals, banks, schools, media houses, farms, laboratories or software companies. Ask lecturers, seniors and family friends for introductions. Apply to several places, and follow up politely. Visit in person where possible, dressed properly, with your documents.</p>
<h2>During the placement</h2>
<ul>
<li><b>Be punctual and neat.</b> Reliability is noticed more than brilliance.</li>
<li><b>Ask questions</b> and listen to your supervisor. Everyone knows a student is still learning.</li>
<li><b>Take notes</b> of what you do each day while it is fresh.</li>
<li><b>Take initiative.</b> When you finish a task, ask what else you can help with.</li>
<li><b>Respect confidentiality.</b> Do not share company information without permission.</li>
</ul>
<h2>Keeping your logbook</h2>
<p>The logbook is your record, and it is assessed. Write it weekly, or even daily. Describe what you did, the tools or methods used, and what you learnt, in your own words. Include sketches or diagrams where they help. Ask your industry-based supervisor to sign and comment regularly, rather than all at the end, because a missing signature is hard to fix later.</p>
<h2>The report</h2>
<p>After the placement you usually write a SIWES report. A common structure is: introduction and the organisation's background, description of the work you did, skills and experience gained, problems met and how you handled them, conclusion and recommendations. Write it clearly, and base it on your logbook notes.</p>
<h2>Making the most of it</h2>
<ul>
<li>Treat it as a long interview. Behave as you would like a future employer to remember you.</li>
<li>Build relationships and keep contacts.</li>
<li>Learn a skill the workplace values, such as a software tool, a measurement method or customer handling.</li>
<li>Stay safe and follow the workplace rules.</li>
</ul>
<p>Students who work through SIWES seriously often return to school with sharper goals and a better understanding of their courses.</p>`
  },
  {
    slug: 'how-to-take-good-lecture-notes',
    title: 'How to Take Good Lecture Notes',
    summary: 'A simple method for notes you can actually revise from, in crowded halls and with fast lecturers.',
    body: `
<p>Good notes save you hours at exam time. Bad notes, or none, leave you depending on someone else's handout. Lecture halls can be crowded and lecturers can be fast, so you need a method that works in those real conditions.</p>
<h2>Before the lecture</h2>
<p>Look at the topic in the course outline or your last notes. Even five minutes of skimming makes the lecture easier to follow, because you already know the main words. Arrive early and sit where you can see the board and hear the lecturer.</p>
<h2>During the lecture</h2>
<ul>
<li><b>Listen first, then write.</b> Do not copy every word. Write the main ideas, definitions, formulas, examples and anything the lecturer repeats or says is important.</li>
<li><b>Use your own short forms</b> (such as "govt", "&rarr;" for "leads to") and keep a list of them so you can read them later.</li>
<li><b>Leave space.</b> Skip a few lines between topics so you can add notes or corrections afterwards.</li>
<li><b>Mark unclear points</b> with a question mark and ask the lecturer or a coursemate afterwards.</li>
<li><b>Date every page</b> and write the course code at the top.</li>
</ul>
<h2>A useful layout</h2>
<p>Divide the page into a wide column for the main notes and a narrow column on the side for keywords and questions. At the bottom, leave room for a two-line summary of the page. This is known as the Cornell method, and it works well on ordinary lined paper.</p>
<h2>After the lecture: the 24-hour rule</h2>
<p>Memory fades quickly. Within a day, read through your notes, fill gaps, correct errors, and write the summary line at the bottom of each page. Ten minutes now saves an hour later. In the side column, write questions that the notes answer. At exam time, you can cover the main notes and quiz yourself.</p>
<h2>Handling fast lecturers</h2>
<p>If a lecturer goes quickly, write keywords only and fill in the rest straight after class from the textbook or a coursemate's notes. Do not stop writing to catch one missed word. Leave a blank and move on.</p>
<h2>Handouts and slides</h2>
<p>When you receive slides or a handout, do not simply file them. Add your own notes beside them, such as examples the lecturer gave and explanations in simple words. A handout that you have written on is far more useful than a clean one.</p>
<h2>Keep things organised</h2>
<ul>
<li>One notebook or section per course.</li>
<li>Keep loose pages in a folder with the course name.</li>
<li>Take clear photos of important boards or diagrams, with permission if required, and file them with the right notes.</li>
</ul>
<h2>Use your notes</h2>
<p>Notes are only valuable if you use them. Combine them with the plan in our guide on <a href="/guides/how-to-plan-your-semester-with-a-timetable">planning your semester</a>, and test yourself with <a href="/guides/how-to-use-past-questions-the-right-way">past questions</a>. By exam season you will have a set of notes written in your own words, which is much easier to revise than anyone else's.</p>`
  }
];

function register(app, { layout, esc, contactEmail, adHead, baseUrl }) {
  const css = `<style>
.pub{max-width:820px;width:100%;margin:24px auto;padding:clamp(18px,4vw,36px);border:1px solid var(--line);border-radius:22px;background:var(--card);box-shadow:0 12px 40px rgba(0,0,0,.12);line-height:1.75}
.pub h1{font-size:clamp(26px,5vw,36px);line-height:1.2;margin:0 0 8px}.pub h2{font-size:21px;margin:28px 0 8px}.pub p,.pub li{font-size:16px}
.pub ul,.pub ol{padding-left:22px}.pub .meta{color:var(--mut);font-size:14px;margin:0 0 18px}
.pub .crumb{font-size:14px;margin:0 0 14px}.pub table.gtab{width:100%;border-collapse:collapse;margin:12px 0;font-size:15px}
.pub table.gtab th,.pub table.gtab td{border:1px solid var(--line);padding:8px 10px;text-align:left}
.pub .gl{display:grid;gap:14px;margin-top:18px}.pub .gl a.g{display:block;border:1px solid var(--line);border-radius:16px;padding:16px 18px;text-decoration:none;color:inherit}
.pub .gl a.g b{display:block;font-size:18px;margin-bottom:4px}.pub .gl a.g span{color:var(--mut);font-size:15px}
.pub .btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
</style>`;
  const page = (title, desc, inner, extraHead) => (req, res) => res.send(layout(title + ' | Studies Hub', `${css}<main class="pub">${inner}</main>`, req.user, { footer: true, description: desc, headExtra: extraHead || '' }));
  const canon = p => `<link rel="canonical" href="${baseUrl}${p}">`;

  app.get('/about', (req, res, next) => page('About Studies Hub',
    'Studies Hub is a free study platform for Nigerian university students: course materials, past questions, timetables, news and student chats in one place.',
    `<h1>About Studies Hub</h1><p class="meta">Last updated ${UPDATED}</p>
<p>Studies Hub is a study platform made for university students in Nigeria. It brings the things students look for every semester into one place: course materials and handouts, past questions, lecture and exam timetables, campus news, and a way to talk to coursemates and friends.</p>
<h2>Why it exists</h2>
<p>Finding the right material at the right time is a daily problem for students. Handouts sit in different WhatsApp groups, past questions are passed around as blurry photos, and timetables change without much notice. Studies Hub gathers these in one organised place, sorted by university, department, level and semester, so you can find what is meant for your course without scrolling through hundreds of messages.</p>
<h2>What you can do</h2>
<ul>
<li><b>Read and save course materials.</b> Open handouts and documents in the app or the website, and save them to read without data.</li>
<li><b>Practise with past questions and CBT-style tests</b> for your course.</li>
<li><b>Check timetables</b> for lectures and examinations.</li>
<li><b>Follow campus news</b> and announcements from your school and departments.</li>
<li><b>Chat and call</b> your friends and study groups, with voice notes, files and group chats.</li>
<li><b>Learn</b> from our free <a href="/guides">study guides</a> on exams, planning, CGPA, projects and more.</li>
</ul>
<h2>Who runs it</h2>
<p>Studies Hub is built around what students actually need, and it is run by its owner together with lecturers and administrators who upload and check materials for their departments. If you notice a mistake in a material, tell us through the <a href="/contact">contact page</a>, and we will correct or remove it.</p>
<h2>Our approach to content</h2>
<p>Materials are uploaded by verified lecturers and administrators. We do not sell students' personal information, and we explain what we collect in our <a href="/privacy">Privacy Policy</a>. The rules for using the platform are in our <a href="/terms">Terms &amp; Conditions</a>.</p>
<div class="btns"><a class="btn" href="/signup">Create a free account</a><a class="btn ghost" href="/how-it-works">How it works</a></div>`, canon('/about'))(req, res));

  app.get('/how-it-works', (req, res) => page('How Studies Hub Works',
    'A step-by-step look at how to sign up, find your course materials, save them for offline use, and use chats and timetables on Studies Hub.',
    `<h1>How Studies Hub Works</h1><p class="meta">Last updated ${UPDATED}</p>
<p>Using Studies Hub takes a few minutes to learn. Here is the path from sign-up to studying.</p>
<h2>1. Create your account</h2>
<p>Sign up with your name and email address, or, where it is offered, continue with Google. We send a link to confirm your email, so use an address you can open. You then choose your university, department and level, which lets us show you the materials meant for your course.</p>
<h2>2. Find your course materials</h2>
<p>From the home screen, pick your course. You will see handouts, notes, past questions and other documents uploaded for it. Each one has a title, and you can open it directly in the page. Semester filters keep first-semester and second-semester materials apart.</p>
<h2>3. Save for later</h2>
<p>On the Android app you can save a material inside the app so you can read it with no data, or download it to your phone's Downloads folder. On the website, you can open or download documents your browser supports.</p>
<h2>4. Practise</h2>
<p>Use the practice and CBT sections to answer questions on your course, check your answers and see where you need more work. Pair this with the method in our guide on <a href="/guides/how-to-use-past-questions-the-right-way">using past questions</a>.</p>
<h2>5. Stay informed</h2>
<p>The News section carries announcements from your school, departments and student bodies. Turn on notifications to hear about new uploads and posts.</p>
<h2>6. Talk to people</h2>
<p>Add friends by username, start one-to-one chats, create groups for your study team, send voice notes and files, and make voice or video calls. You choose whether others see when you are online, in your settings.</p>
<h2>7. Keep your account safe</h2>
<p>Use a strong password, log out on shared devices, and never share your login. If something looks wrong, <a href="/contact">contact us</a>.</p>
<div class="btns"><a class="btn" href="/signup">Get started</a><a class="btn ghost" href="/guides">Read the study guides</a></div>`, canon('/how-it-works'))(req, res));

  app.get('/contact', (req, res) => {
    const em = esc(contactEmail);
    page('Contact Studies Hub',
      'How to reach Studies Hub for help, to report a problem with a material, to ask about uploading, or to give feedback.',
      `<h1>Contact Us</h1><p class="meta">Last updated ${UPDATED}</p>
<p>We read every message. Write to us by email at <a href="mailto:${em}">${em}</a>.</p>
<h2>What to write to us about</h2>
<ul>
<li><b>Help with your account:</b> login problems, verification emails, or changing your details. Tell us the email address you signed up with. Never send your password.</li>
<li><b>A problem with a material:</b> a wrong, outdated or broken document. Tell us the course and the title so we can find it quickly.</li>
<li><b>Lecturers and course representatives:</b> if you want to upload materials for your department, tell us your name, school and role.</li>
<li><b>Privacy requests:</b> to ask what we hold about you or to have your account deleted. See our <a href="/privacy">Privacy Policy</a>.</li>
<li><b>Feedback and ideas:</b> what works, what does not, and what you would like us to add.</li>
</ul>
<h2>How long a reply takes</h2>
<p>We aim to reply within a few working days. If your message is urgent, such as a security concern about your account, say so in the subject line.</p>
<h2>Report content</h2>
<p>If you believe a material or a post breaks the rules in our <a href="/terms">Terms &amp; Conditions</a>, or infringes your rights, email us the link and a short explanation, and we will review it promptly.</p>`, canon('/contact'))(req, res);
  });

  app.get('/guides', page('Study Guides for Nigerian University Students',
    'Free, practical study guides: exam preparation, planning your semester, past questions, CGPA, project proposals, CBT, SIWES and lecture notes.',
    `<h1>Study Guides</h1><p class="meta">Free, practical guides written for university students in Nigeria. Last updated ${UPDATED}</p>
<p>These guides explain, step by step, the things students most often ask about: how to prepare for exams, how to plan a semester, how to use past questions, how your CGPA is worked out, and how to handle projects, CBT and industrial training.</p>
<div class="gl">${GUIDES.map(g => `<a class="g" href="/guides/${g.slug}"><b>${esc(g.title)}</b><span>${esc(g.summary)}</span></a>`).join('')}</div>`, canon('/guides')));

  app.get('/guides/:slug', (req, res, next) => {
    const g = GUIDES.find(x => x.slug === req.params.slug);
    if (!g) return next();
    const ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.summary, inLanguage: 'en-NG', publisher: { '@type': 'Organization', name: 'Studies Hub', url: baseUrl }, mainEntityOfPage: `${baseUrl}/guides/${g.slug}` }).replace(/</g, '\\u003c')}</script>`;
    const others = GUIDES.filter(x => x.slug !== g.slug).slice(0, 4);
    page(g.title, g.summary, `<p class="crumb"><a href="/guides">&larr; All study guides</a></p><h1>${esc(g.title)}</h1><p class="meta">Studies Hub &middot; Updated ${UPDATED}</p>${g.body}
<h2>More guides</h2><div class="gl">${others.map(o => `<a class="g" href="/guides/${o.slug}"><b>${esc(o.title)}</b><span>${esc(o.summary)}</span></a>`).join('')}</div>
<div class="btns"><a class="btn" href="/signup">Join Studies Hub free</a></div>`, canon('/guides/' + g.slug) + ld + adHead)(req, res);
  });

  const pages = ['/', '/about', '/how-it-works', '/contact', '/guides', '/privacy', '/terms', ...GUIDES.map(g => '/guides/' + g.slug)];
  app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `<url><loc>${baseUrl}${p === '/' ? '/' : p}</loc></url>`).join('\n')}\n</urlset>\n`));
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /lecturer\nDisallow: /uni\nDisallow: /chat\nDisallow: /api/\nDisallow: /settings\nDisallow: /call/\nDisallow: /p/\nDisallow: /u/\nDisallow: /saved\n\nSitemap: ${baseUrl}/sitemap.xml\n`));
}

module.exports = { register, GUIDES };
