# The learning science behind Anamnesis

Anamnesis is built on a handful of well-replicated findings about how people learn and remember, plus the newer and more mixed evidence on LLM tutors. This page lists each finding, what the app does with it, and where in the code that happens. Figures are quoted only from sources that were read for this project; everything else is described in words and marked as such.

## At a glance

| Finding | What the app does | Where |
|---|---|---|
| Retrieval practice | Every step asks before it tells; practice and reviews are retrieval | `src/shared/prompts.ts` (rules 1 and 2), `src/shared/selection.ts` |
| Pretesting and prediction | A probe phase, and a prediction before every explanation | `prompts.ts` (PROBE, TEACH), `src/renderer/src/engine/session.ts` |
| Worked examples for new material | Explain cards show one correct worked step | `prompts.ts` (TEACH) |
| Spacing and successive relearning | One FSRS-6 memory model per concept; failed reviews are relearned in the same session | `src/shared/fsrs.ts`, `src/shared/mastery.ts`, `session.ts` |
| Interleaving | Practice mixes concepts and never repeats one back to back | `selection.ts` |
| Desirable difficulty | A five-level staircase per concept: harder means composed demands and less familiar cues | `mastery.ts` (`updateLevel`), `selection.ts` |
| Mastery gating | A plan node passes only on its check; a failed check gets a different explanation | `session.ts` (`nodePassed`) |
| Informational feedback, nudges | Feedback per answer option; a hint ladder that never gives the answer | `prompts.ts` (rules 4 and 5), `src/shared/grading.ts` |
| Calibration and hypercorrection | Confidence on every graded item, calibration stats, a bonus for fixing confident errors | `src/shared/stats.ts`, `src/shared/rewards.ts` |
| Explaining in your own words | An explain-back of the whole chain at the end of every learn session | `prompts.ts` (WRAP) |
| Rewards that inform | Points only for evidence of understanding, each with its reason | `rewards.ts` |
| Words and pictures, small steps | interactive widgets built per idea, 14 ready-made demos, plots and diagrams; short cards | `src/renderer/src/widgets/`, `src/renderer/src/demos/`, `prompts.ts` (rules 2 and 6) |
| Open learner model | The mind model is visible, explained and editable | `src/renderer/src/views/MindView.tsx` |

## 1. Retrieval practice

**Evidence.** Trying to recall something strengthens memory more than reading it again: the testing effect (Roediger & Karpicke, 2006). It holds in real classrooms. A meta-analysis of 222 classroom studies with 48,478 students found a medium overall benefit of quizzing, Hedges' g = 0.499 (Yang et al., 2021). Corrective feedback, the number of quiz repetitions and how well quiz and test formats match all moderate the effect.

**In the app.** The tutor's first rule is "retrieval and generation before exposition" (`CORE_RULES` in `src/shared/prompts.ts`), and every step must contain at least one card that makes you think rather than just "Continue". Practice items and reviews are pure retrieval, each with immediate feedback and a worked solution. The learner model counts only answered items as evidence (`src/shared/mastery.ts`), and the stats measure performance on retrieval items, never time spent (`src/shared/stats.ts`).

## 2. Pretesting and prediction

**Evidence.** Attempting questions before instruction improves later learning of that material, even when the attempts are wrong. A review of prequestion and pretest research reports effects from Cohen's d = 0.44 to well over 2.0 at retention intervals of at least 24 hours. The benefit is robust for the pretested items themselves and inconsistent for related items that were not pretested (Pan & Carpenter, 2023). In one comparison pretesting even beat retrieval practice (ds = 0.30 and 0.14; Pan & Sana, 2021). Brod (2021) describes predicting as committing to an answer with at least some confidence, followed by immediate feedback; the surprise of a wrong prediction is associated with better later retrieval.

**In the app.**

* **Probe.** A learn session starts with one or two rounds of 1 to 3 short diagnostic questions, with an honest "I don't know yet" button and neutral feedback. The probe finds the gaps for the plan and works as a pretest at the same time. Because the benefit is strongest for the pretested items, the tutor is told to make probe questions relevant to the goal.
* **Predict, explain, check.** Every node of the plan starts with a prediction you can reason out from the nodes already in place. The explanation then builds on your guess ("If you guessed 0, exactly: ..."). Closed predictions get feedback per option right away; open predictions are compared with the reveal by you.
* **Commitment counts, correctness barely.** A committed prediction earns points even when it is wrong (`src/shared/rewards.ts`). In the learner model a prediction weighs 0.3 and a probe 0.6, against 1 for a check, so a wrong guess before teaching hardly moves the mastery estimate (`evidenceWeight` in `mastery.ts`).

## 3. Bounded productive failure

**Evidence.** Problem solving before instruction can beat instruction first for conceptual understanding and transfer, but only when the problem phase is designed with care and instruction afterwards builds on the learners' attempts (Sinha & Kapur, 2021, a meta-analysis; described in words here). Struggle without that consolidation does not show the benefit.

**In the app.** The failure is short and bounded: one attempt per prediction, then an explanation that uses your attempt. Longer struggle happens only in checks and practice, where the hint ladder is always available (section 9).

## 4. Worked examples for new material

**Evidence.** For new material in mathematics, studying worked examples beats solving problems unaided: g = 0.48 across 55 studies (Barbieri et al., 2023). Correct examples worked better than incorrect or mixed ones, and adding self-explanation prompts to examples was a negative moderator. As expertise grows the advantage fades and practice becomes the better use of time (the expertise reversal effect; Kalyuga et al., 2003).

**In the app.** Explain cards show one correct worked step with an equation block and a concrete example or a visual. They do not ask you to self-explain each example; the single explain-back comes at the end of the session (section 11). Once a concept has been taught, the app moves to practice, where hints and the worked solution act as support that you call on only when needed.

## 5. Spacing, memory models and successive relearning

**Evidence.** Spreading study over time beats massing it, and the best gap grows with how long you need to remember (Cepeda et al., 2006). Spaced repetition algorithms schedule each item for just before it would be forgotten. FSRS models memory with difficulty, stability and retrievability, where stability S is the time it takes the probability of recall to fall to 90%. On a benchmark of 9,999 Anki collections with about 350 million reviews, FSRS-6 predicted recall better than SM-2 (Anki's older algorithm) in 99.6% of collections (Expertium benchmark). Successive relearning, retrieving to a criterion and relearning in later sessions, combines retrieval and spacing (Rawson & Dunlosky, 2022).

**In the app.** Each course concept has one FSRS-6 card with the published default parameters (`src/shared/fsrs.ts`). Its forgetting curve is

$$
R(t, S) = \left(1 + F\,\frac{t}{S}\right)^{-w_{20}}, \qquad F = 0.9^{-1/w_{20}} - 1,
$$

so that $R(S, S) = 0.9$. After each graded retrieval the app chooses the FSRS rating from what you did, not from a self-rating (`ratingFor` in `mastery.ts`):

* a revealed solution or a score below 50% is Again,
* two or more hints, a score below 80% or low confidence is Hard,
* a clean answer you were certain of is Easy,
* anything else is Good.

A concept comes back for review when its predicted recall falls to the target retention (90% by default, in Settings → Learning), least remembered first. A failed review returns within half a day, and inside a review session it also triggers a short re-explanation and a fresh item after one other item (`afterStepComplete` in `src/renderer/src/engine/session.ts`). Memory is shown separately from understanding, because you can understand something and still be about to forget it.

## 6. Interleaving

**Evidence.** Mixing problem types during practice helps people learn to tell them apart. A meta-analysis of 59 studies found an overall g = 0.42, g = 0.34 for mathematics, and a reverse effect for word lists (g = −0.39). Interleaving helps most when the categories are similar to each other and hard to tell apart (Brunmair & Richter, 2019).

**In the app.** Practice draws from concepts you have already met, never repeats a concept back to back, and lowers a concept's priority each time it is chosen so the others get their turn (`practiceQueue` in `src/shared/selection.ts`). Harder items compose a concept with its neighbours in the course graph, or ask you to discriminate between them ("which statement is wrong"), which is where similar categories meet. New concepts are taught one at a time, one goal per learn session, and mixed only once they have been introduced.

## 7. Desirable difficulty and the staircase

**Evidence.** Practice that is too easy teaches little, and some difficulty during learning is desirable (Bjork & Bjork, 2011). A model-based argument suggests that learning is fastest when training is hard enough to produce some errors, around 15% for a broad class of learning algorithms (Wilson et al., 2019; described in words here). Adaptive staircases from psychophysics hold a learner at a fixed success rate: with the rule "three right in a row makes it harder, one miss makes it easier", the level settles where $p^3 = 1/2$, that is at about 79% correct (Levitt, 1971).

**In the app.** Every concept has a practice level from L1 to L5 that follows this staircase (`updateLevel` in `mastery.ts`). The levels raise difficulty by composing demands and making cues less familiar, not by adding tedious arithmetic (`cueForLevel` and `modeForLevel` in `selection.ts`):

| Level | Demand | Cue |
|---|---|---|
| L1 | recall or recognize a definition, property or formula | familiar |
| L2 | apply one step | mostly familiar, sometimes shifted |
| L3 | compose two demands, or use one in an unfamiliar representation | shifted |
| L4 | multi-step, including exam-style (S)/(M) "which statement is wrong" items | novel |
| L5 | exam transfer: derivations, cost or convergence analysis, numpy code completion | novel |

## 8. Mastery gating

**Evidence.** Bloom (1984) reported large gains for mastery learning, where learners move on only after showing mastery, and larger ones for one-to-one tutoring: the "two sigma problem" that tutoring systems try to solve (described in words here). For AI tutors specifically, the Stanford SCALE review reports that Oreopoulos and colleagues found a gain on practiced material only when students were required to answer three questions correctly in a row.

**In the app.** A plan node passes only when every check on it reaches an effective score of at least 0.6 (`nodePassed` in `session.ts`). A failed node is taught again with a different representation and a new check in a new surface, and the tutor is told never to repeat the same explanation. After two attempts the node is marked shaky and the session moves on rather than looping; the shaky node stays visible in the plan and in the mind model. A concept counts as proficient only when its mastery estimate is high, the lower edge of its uncertainty band is also high, and you have solved an L3 item without help. Mastered additionally needs unaided successes on three separate days spanning at least five days, an L4 item solved without help and a current recall of at least 80% (`deriveStatus` in `mastery.ts`).

## 9. Informational feedback and nudges

**Evidence.** Feedback helps most when it tells the learner about the task and their process (what was right, what was wrong and why) and least when it is praise or a grade alone (Hattie & Timperley, 2007; described in words here). Help that leaves the work to the learner preserves learning, while handing over solutions removes the effort that produces it (see the LLM tutor evidence below).

**In the app.**

* **Feedback.** One or two sentences on what was right, what was wrong and why; praise names the specific reasoning (rule 5 of `CORE_RULES`). Each multiple-choice distractor has its own feedback and is mapped to the misconception it reveals, which then goes into the learner model.
* **Hint ladder.** Two to four hints per item, from "what is asked, what is known?" to almost the whole step, never the final answer (rule 4). "I don't know" on a check gives the next hint, then the solution.
* **Honest accounting.** The full solution is always one click away, but help reduces what an answer says about you. With raw score $s$, $h$ hints and $a$ attempts, the effective score is

  $$
  e = s \cdot \max\bigl(0.3,\; 1 - 0.2\,h - 0.25\,(a - 1)\bigr),
  $$

  and a revealed solution gives $e = 0$ (`effectiveScore` in `mastery.ts`).
* **Side questions.** You can ask the tutor a question at any time. If the answer would give away the item you are working on, the tutor replies with a nudge instead (`buildChatPrompt` in `prompts.ts`).

## 10. Calibration and hypercorrection

**Evidence.** Learners often judge what they know by how fluent it feels, and overestimate it (Bjork, Dunlosky & Kornell, 2013). Errors made with high confidence are, surprisingly, the ones most likely to be corrected after feedback: the hypercorrection effect (Butterfield & Metcalfe, 2001).

**In the app.** Every graded item asks how sure you are: guess, unsure, fairly sure or certain, read as 25%, 50%, 75% and 95%. The stats compare each confidence level with your observed accuracy and report a Brier score and a signed over- or underconfidence (`calibrationBins`, `brierScore` and `confidenceBias` in `stats.ts`). Certain-and-right answers and honestly flagged uncertainty earn small rewards, and fixing without help an error you were confident about in the last two weeks earns a hypercorrection bonus.

## 11. Explaining the chain in your own words

**Evidence.** Explaining what you learned in your own words is a generative activity that supports understanding, as long as the explanation is checked (Fiorella & Mayer, 2016; described in words here).

**In the app.** Every learn session ends with an explain-back: you explain the chain from your anchors to the goal, typed or spoken (speech is transcribed locally by Whisper, which makes a longer explanation less of a chore). A separate grading call scores it against a rubric of three to five key points and a model answer, names what is missing, and allows a second attempt. It is the highest-weighted evidence (1.2) and earns the largest single reward.

## 12. Rewards that inform

**Evidence.** A meta-analysis of gamification in education found positive effects on cognitive (g = 0.49, 95% CI [0.30, 0.69]), motivational (g = 0.36) and behavioural outcomes (g = 0.25); among the methodologically rigorous studies only the cognitive effect held (g = 0.42) (Sailer & Homner, 2020). Expected rewards for simply doing a task can undermine intrinsic motivation, while informational feedback does not (Deci, Koestner & Ryan, 1999; described in words here).

**In the app.** Insight points reward evidence of understanding only. There are no points for time, daily streaks, clicks or revealed solutions, and no leaderboard. Every award names what earned it (`rewardsForResponse` in `rewards.ts`), which makes it feedback rather than a bribe. Points grow with difficulty and independence:

| Evidence | Points |
|---|---|
| Committed to a prediction (even a wrong one) | 2, plus 4 if right, or 3 if your open prediction matched the reveal |
| Honest attempt on a probe question | 1, plus 2 if you already knew it |
| Check solved | 10 on your own, down to 3 with help; 3 if partly right |
| Practice or review item solved | 8 × level factor (1 to 2.5) × help factor; half if partly right |
| Still knew it at a review after a day or more | 4 |
| Explained the whole chain | 15, or 8 if mostly right |
| Certain and right / wrong but flagged as a guess or unsure | 2 / 1 |
| Corrected a confident error without help | 6 |
| Proficient / mastered / level up / walked the whole plan | 30 / 60 / 5 / 20 |

## 13. Words and pictures, in small steps

**Evidence.** People learn better from words and pictures together than from words alone, and from learner-paced segments rather than one continuous stream (Mayer, 2009, the multimedia and segmenting principles; described in words here).

**In the app.** The tutor must use a visual whenever an idea is geometric, dynamic or comparative (rule 6). It has 14 interactive demos built on unit-tested numerics, plus plots, Mermaid diagrams, tables and small sandboxed sketches. Prose blocks stay under about 90 words with at most three content blocks per card (rule 2), and every card can be read aloud.

## 14. An open learner model

**Evidence.** Open learner models, which let learners see and question what a tutoring system believes about them, support reflection and self-regulation (Bull & Kay, 2016; described in words here).

**In the app.** The mind model shows, for every concept, mastery with an uncertainty band, memory strength, practice level, the understanding, independence and transfer facets, active and resolved misconceptions, the tutor's notes and your own, and the evidence behind every number. You can edit or delete misconceptions and notes. Your own notes are passed to the tutor marked as trusted (`conceptModelLine` in `prompts.ts`).

## What LLM tutors add, and what can go wrong

The evidence on LLM tutors is new and mixed. It is the main reason for the guardrails in the design.

* **A well-designed tutor can beat good teaching.** In a crossover trial in a Harvard physics course (N = 194), students learned more from an AI tutor built on pedagogical best practices than in an active-learning class. The effect size was 0.63 by regression, which the authors call an underestimate because of a ceiling, and 0.73 to 1.3 standard deviations by quantile regression, with a median of 49 minutes on task (Kestin et al., 2025).
* **An answer machine harms learning.** With about 1,000 high-school maths students, a plain chat assistant raised practice performance by 48% but lowered exam performance by 17% once access was removed. A tutor version with hints and safeguards raised practice performance by 127% and largely avoided the harm (Bastani et al., 2025).
* **Design and integration decide the outcome.** In a pre-registered trial with 7,200 students in 55 course and instructor pairs at 19 institutions, AI tools designed by the instructors raised proctored exam scores by 0.32 standard deviations (95% CI [0.06, 0.59]); most of those instructors required students to attempt problems and explain their reasoning before receiving answers (arXiv 2611.19099, 2026). In contrast, in a randomized trial with 2,379 undergraduates, a general study assistant added to courses without integration, and used mostly in direct-answer mode, was followed by final grades 0.37 standard deviations lower. 73.8% of requests sought information, explanations or solutions, and 0.7% sought feedback on the student's own work (EdWorkingPaper 26-1598, 2026).
* **Reviews agree on the direction.** A Microsoft review calls simple prompt guardrails ("act as an instructor, withhold solutions") basic and insufficient, and recommends design for engagement and metacognitive calibration (Walker & Vorvoreanu, 2025). The Stanford SCALE review of 52 causal studies concludes that AI shows more promise when it supports learning than when it replaces student thinking. It also notes that Cao and colleagues found immediate answers with explanations beat hint-first chatbots, so adding pedagogical structure alone is no guarantee (Stanford SCALE, 2026).

The guardrails that follow from this:

1. **No free chat.** Every tutor reply is one JSON object rendered as interactive cards (`src/shared/schema.ts`), so the default path is attempt, then feedback, not question, then answer. The side-question box answers in under 120 words and nudges when the answer would give away the current item.
2. **Attempt first, without making help hard to get.** Predictions and checks come before solutions, and hints never contain the answer. The solution is still one click away (the Cao et al. caveat), and using it counts honestly in mastery, memory and points.
3. **The numbers are not the model's opinion.** Mastery, memory, levels and stats are computed from the evidence log with fixed, unit-tested formulas (`mastery.ts`, `fsrs.ts`, `stats.ts`). The LLM contributes only notes, misconceptions and observations about how you learn, all of which you can edit or delete.
4. **What the app can grade, it grades itself.** Multiple-choice, numeric, ordering and fill-in answers are graded locally and instantly (`src/shared/grading.ts`), with numeric keys evaluated by a locked-down math.js. Only free text goes to a separate grading call, with a rubric and a model answer.
5. **Correct visuals.** Demos compute with tested numerics (`src/shared/numerics.ts`) rather than relying on pictures the model draws.
6. **Grounded in the script.** The tutor gets the text of the relevant pages, uses the script's notation and theorem numbers, and links the exact page, so every claim can be checked against the source.

## Limits

* Most of these effects were measured with school or undergraduate students, in classrooms and in other subjects. That they carry over to one student working through NumCS with an LLM tutor is plausible, not shown.
* The app itself has not been evaluated. Its stats help you judge your own understanding; they are not evidence that the app works.
* Many parameters are reasoned defaults rather than fitted values: the evidence weights, the discount of old evidence, the help penalties, the status thresholds, and FSRS's default parameters. FSRS can be fitted to one person's reviews once there are enough of them; the app does not do that yet.
* A review is a new item on the concept, not the same flashcard again, so FSRS models the memory of a concept through varying items. That is closer to what an exam asks, but noisier than flashcard reviews.
* LLM-written items can be wrong despite the rules. When an answer key looks wrong, check the worked solution and the script page, both one click away.

## Sources

Read for this project (the figures above come from these):

* Barbieri, C. A., et al. (2023). A meta-analysis of the worked examples effect on mathematics performance. *Educational Psychology Review, 35*, 11. <https://doi.org/10.1007/s10648-023-09745-1>
* Bastani, H., et al. (2025). Generative AI without guardrails can harm learning: Evidence from high school mathematics. *PNAS, 122*(26). <https://papers.ssrn.com/abstract=4895486>
* Brod, G. (2021). Predicting as a learning strategy. *Psychonomic Bulletin & Review*. <https://pmc.ncbi.nlm.nih.gov/articles/PMC8642250>
* Brunmair, M., & Richter, T. (2019). Similarity matters: A meta-analysis of interleaved learning and its moderators. *Psychological Bulletin*. <https://pubmed.ncbi.nlm.nih.gov/31556629/>
* Expertium. Benchmark of spaced repetition algorithms. <https://expertium.github.io/Benchmark.html>; A technical explanation of FSRS-6. <https://expertium.github.io/Algorithm.html>
* Instructor-designed AI improves learning in a randomized trial across 19 universities (2026). arXiv 2611.19099. <https://arxiv.org/html/2611.19099v1>
* Kestin, G., et al. (2025). AI tutoring outperforms in-class active learning: an RCT introducing a novel research-based design in an authentic educational setting. *Scientific Reports*. <https://www.nature.com/articles/s41598-025-97652-6>
* Pan, S. C., & Carpenter, S. K. (2023). Prequestioning and pretesting effects: a review of empirical research, theory, and recommendations. *Educational Psychology Review*. <https://doi.org/10.1007/s10648-023-09814-5>
* Pan, S. C., & Sana, F. (2021). Pretesting versus posttesting: Comparing the pedagogical benefits of errorful generation and retrieval practice. *Journal of Experimental Psychology: Applied*. <https://pubmed.ncbi.nlm.nih.gov/33793291/>
* Sailer, M., & Homner, L. (2020). The gamification of learning: a meta-analysis. *Educational Psychology Review, 32*. <https://doi.org/10.1007/s10648-019-09498-w>
* Stanford SCALE (2026). The evidence base on AI in K-12: A November 2026 review. <https://scale.stanford.edu/ai/evidence-base-review/evidence-base-ai-k12-november-review>
* The effects of course-integrated AI tutoring on student performance and engagement (2026). EdWorkingPaper No. 26-1598. <https://edworkingpapers.com/sites/default/files/ai26-1598.pdf>
* Walker, K., & Vorvoreanu, M. (2025). Learning outcomes with GenAI in the classroom: A review of empirical evidence. Microsoft. <https://www.microsoft.com/en-us/research/wp-content/uploads/2025/10/GenAILearningOutcomes_published_2025-12-16.pdf>
* Yang, C., et al. (2021). Testing (quizzing) boosts classroom learning: A systematic and meta-analytic review. *Psychological Bulletin, 147*(4), 399–435. <https://doi.org/10.1037/bul0000309>

Cited for well-established ideas, described in words only:

* Bjork, E. L., & Bjork, R. A. (2011). Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning. In *Psychology and the real world*.
* Bjork, R. A., Dunlosky, J., & Kornell, N. (2013). Self-regulated learning: Beliefs, techniques, and illusions. *Annual Review of Psychology, 64*.
* Bloom, B. S. (1984). The 2 sigma problem: The search for methods of group instruction as effective as one-to-one tutoring. *Educational Researcher, 13*(6).
* Bull, S., & Kay, J. (2016). SMILI: A framework for interfaces to learning data in open learner models, learning analytics and related fields. *International Journal of Artificial Intelligence in Education, 26*.
* Butterfield, B., & Metcalfe, J. (2001). Errors committed with high confidence are hypercorrected. *Journal of Experimental Psychology: Learning, Memory, and Cognition, 27*(6).
* Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin, 132*(3).
* Deci, E. L., Koestner, R., & Ryan, R. M. (1999). A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation. *Psychological Bulletin, 125*(6).
* Fiorella, L., & Mayer, R. E. (2016). Eight ways to promote generative learning. *Educational Psychology Review, 28*.
* Hattie, J., & Timperley, H. (2007). The power of feedback. *Review of Educational Research, 77*(1).
* Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist, 38*(1).
* Levitt, H. (1971). Transformed up-down methods in psychoacoustics. *Journal of the Acoustical Society of America, 49*.
* Mayer, R. E. (2009). *Multimedia learning* (2nd ed.). Cambridge University Press.
* Rawson, K. A., & Dunlosky, J. (2022). Successive relearning: An underexplored but potent technique for obtaining and maintaining knowledge. *Current Directions in Psychological Science, 31*(4).
* Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science, 17*(3).
* Sinha, T., & Kapur, M. (2021). When problem solving followed by instruction works: Evidence for productive failure. *Review of Educational Research, 91*(5).
* Wilson, R. C., Shenhav, A., Straccia, M., & Cohen, J. D. (2019). The Eighty Five Percent Rule for optimal learning. *Nature Communications, 10*. <https://doi.org/10.1038/s41467-019-12552-4>
