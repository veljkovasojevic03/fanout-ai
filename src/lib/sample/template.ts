import type { AppLocale } from "@/i18n/config";
import type { ContentType, Tone } from "@/lib/presets";

/*
 * Sample output for a topic that has no hand-written fixture.
 *
 * It is deliberately, visibly generic: it names the topic and keywords so the
 * user can see their input flow through, describes what the real piece would
 * contain, and says outright that it is a sample. It never pretends to be a
 * finished piece about the topic — that would be passing canned text off as AI.
 *
 * Every template obeys the same contracts as live output (see the tests), for
 * any topic up to 300 characters and any keyword list.
 */

export type TemplateInput = {
  topic: string;
  tone: Tone;
  keywords: readonly string[];
  language: AppLocale;
};

const clip = (value: string, max: number): string => {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  return chars.length <= max
    ? chars.join("")
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
};

/** "content marketing" → "#contentmarketing". Returns null when nothing usable is left. */
export function toHashtag(keyword: string): string | null {
  const cleaned = Array.from(keyword.toLowerCase())
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .slice(0, 30)
    .join("");
  return cleaned ? `#${cleaned}` : null;
}

/** Up to `max` distinct hashtags: the user's keywords first, then the defaults. */
function hashtags(keywords: readonly string[], defaults: readonly string[], max: number): string {
  const tags: string[] = [];
  for (const candidate of [...keywords.map(toHashtag), ...defaults]) {
    if (candidate && !tags.includes(candidate) && tags.length < max) tags.push(candidate);
  }
  return tags.join(" ");
}

const TONE: Record<AppLocale, Record<Tone, string>> = {
  en: {
    professional: "professional",
    casual: "casual",
    funny: "funny",
    inspirational: "inspirational",
  },
  // Locative case, to fit "u … tonu".
  sr: {
    professional: "profesionalnom",
    casual: "opuštenom",
    funny: "duhovitom",
    inspirational: "inspirativnom",
  },
};

/** The keywords as one readable list, capped so it cannot push a piece past its word limit. */
const keywordList = (keywords: readonly string[]) =>
  clip(keywords.map((keyword) => clip(keyword, 40)).join(", "), 140);

function english({ topic, tone, keywords }: TemplateInput): Record<ContentType, string> {
  const t = TONE.en[tone];
  const short = clip(topic, 80);
  const kw = keywords.length
    ? ` It would work in your keywords naturally: ${keywordList(keywords)}.`
    : "";

  return {
    blog: `---
meta_title: ${clip(topic, 60)}
meta_description: Sample outline for a blog post about: ${clip(topic, 90)}
---

# ${clip(topic, 120)}

This is sample output. Fanout has not written a real article here: it is showing you the shape a blog post takes, using the topic you entered. In Live mode the article is written for you, in a ${t} tone.${kw}

## The opening

A real post starts with a short introduction that tells the reader what they will get and why it matters to them. It names the problem in plain words and promises a clear answer.

## The main points

The body is split into three to five sections like this one. Each section makes one point about "${short}", backs it up with an example, and stays short enough to read on a phone.

## The practical part

Good posts give the reader something to do. This is where a real article would turn the ideas into steps, a checklist, or a worked example.

## The conclusion

The post ends by repeating the main idea in one or two sentences and inviting the reader to take a next step. Generate in Live mode to see the finished article.
`,

    linkedin: `Sample draft: ${short}

This is a pre-written sample, so you can see how a LinkedIn post from Fanout is shaped before any AI is involved.

A real post would open with a hook about your topic, written in a ${t} tone. The first line has to earn the click on "see more".

Then come a few short paragraphs. Each one makes a single point and leaves plenty of white space, because that is how people read on a phone.

After that you get one clear takeaway, something a reader can use the same day.${kw}

The post closes with a soft call to action, usually a question that invites a reply.

In Live mode, Fanout writes the real post about your topic.

What would you want this post to say?

${hashtags(keywords.slice(0, 3), ["#sample", "#fanout"], 5)}`,

    instagram: `Sample caption: ${clip(topic, 60)} ✨

This is a pre-written sample, so you can see the shape of an Instagram caption from Fanout before any AI is involved.

A real one opens with a hook, adds two to four short lines in a ${t} tone, and ends with a clear call to action. The hashtags sit on their own last line.

In Live mode you get a caption written about your topic.

${hashtags(keywords.slice(0, 3), ["#sample", "#fanout", "#content", "#caption", "#socialmedia"], 8)}`,

    email: `Subject: Sample email: ${clip(topic, 60)}
Preheader: A pre-written sample showing how a Fanout newsletter is laid out.

Hi there,

This is sample output, so nothing here was written by AI. It shows how Fanout lays out an email newsletter, using the topic you entered: "${short}".

**The opening**

A real email starts with a friendly greeting and one or two sentences that tell the reader why this message is worth their time. It would be written in a ${t} tone, and it would sound like one person writing to another.

**The main message**

The body is split into three compact sections like these. Each one covers a single idea and stays short, because most people skim email.${kw}

**The next step**

Every email has exactly one call to action. It is placed where a reader will see it and says plainly what happens when they click. A good one is specific, short, and easy to act on from a phone.

**[Your call to action goes here](https://example.com)**

In Live mode, Fanout writes the real email about your topic.

Thanks for reading,
The Fanout sample`,

    x_thread: `1/ Sample thread: ${clip(topic, 100)} 🧵

2/ This is a pre-written sample. It shows how Fanout shapes a thread on X before any AI is involved.

3/ A real thread opens with a hook in the first post. That post has one job: to make people want to read the next one.

4/ The middle posts each make a single point, in a ${t} tone. Every post stays under 280 characters, and Fanout warns you if one goes over.

5/ Your keywords would be worked in naturally, not stuffed in. You can edit any post after it is generated.

6/ The last post is a call to action. In Live mode, Fanout writes the real thread about your topic.`,
  };
}

function serbian({ topic, tone, keywords }: TemplateInput): Record<ContentType, string> {
  const t = TONE.sr[tone];
  const short = clip(topic, 80);
  const kw = keywords.length
    ? ` Prirodno bi uklopio tvoje ključne reči: ${keywordList(keywords)}.`
    : "";

  return {
    blog: `---
meta_title: ${clip(topic, 60)}
meta_description: Primer strukture blog posta na temu: ${clip(topic, 90)}
---

# ${clip(topic, 120)}

Ovo je primer izlaza. Fanout ovde nije napisao pravi članak: pokazuje ti oblik koji blog post ima, koristeći temu koju si uneo. U Live režimu članak se piše za tebe, u ${t} tonu.${kw}

## Uvod

Pravi tekst počinje kratkim uvodom koji čitaocu kaže šta će dobiti i zašto mu je to važno. Problem imenuje jednostavnim rečima i obećava jasan odgovor.

## Glavne poente

Telo teksta je podeljeno na tri do pet ovakvih celina. Svaka iznosi jednu poentu o temi "${short}", potkrepljuje je primerom i ostaje dovoljno kratka da se pročita na telefonu.

## Praktični deo

Dobri tekstovi daju čitaocu nešto konkretno da uradi. Ovde bi pravi članak pretvorio ideje u korake, kontrolnu listu ili razrađen primer.

## Zaključak

Tekst se završava tako što u rečenici ili dve ponovi glavnu ideju i pozove čitaoca na sledeći korak. Generiši u Live režimu da vidiš gotov članak.
`,

    linkedin: `Primer objave: ${short}

Ovo je unapred napisan primer, da vidiš kako Fanout oblikuje LinkedIn objavu pre nego što se uključi bilo kakav AI.

Prava objava bi počela udicom o tvojoj temi, napisanom u ${t} tonu. Prvi red mora da zasluži klik na "prikaži više".

Zatim sledi nekoliko kratkih pasusa. Svaki iznosi jednu poentu i ostavlja dosta praznog prostora, jer tako ljudi čitaju na telefonu. Duge blokove teksta većina jednostavno preskoči, koliko god da su dobro napisani.

Posle toga dolazi jedan jasan zaključak, nešto što čitalac može da primeni još istog dana.${kw}

Objava se završava blagim pozivom na akciju, najčešće pitanjem koje poziva na odgovor. Na kraju stoji najviše pet heštegova.

U Live režimu Fanout piše pravu objavu o tvojoj temi.

Šta bi ti voleo da ova objava kaže?

${hashtags(keywords.slice(0, 3), ["#primer", "#fanout"], 5)}`,

    instagram: `Primer opisa: ${clip(topic, 60)} ✨

Ovo je unapred napisan primer, da vidiš kako Fanout oblikuje opis za Instagram pre nego što se uključi bilo kakav AI.

Pravi opis počinje udicom, dodaje dva do četiri kratka reda u ${t} tonu i završava jasnim pozivom na akciju. Heštegovi stoje u posebnom, poslednjem redu.

U Live režimu dobijaš opis napisan o tvojoj temi.

${hashtags(keywords.slice(0, 3), ["#primer", "#fanout", "#sadržaj", "#opis", "#društvenemreže"], 8)}`,

    email: `Subject: Primer emaila: ${clip(topic, 60)}
Preheader: Unapred napisan primer koji pokazuje kako Fanout slaže bilten.

Zdravo,

Ovo je primer izlaza, pa ništa ovde nije napisao AI. Pokazuje kako Fanout slaže email bilten, koristeći temu koju si uneo: "${short}".

**Uvod**

Pravi email počinje prijateljskim pozdravom i rečenicom ili dve koje čitaocu kažu zašto ova poruka vredi njegovog vremena. Bio bi napisan u ${t} tonu i zvučao bi kao da jedna osoba piše drugoj.

**Glavna poruka**

Telo je podeljeno na tri sažete celine poput ovih. Svaka pokriva jednu ideju i ostaje kratka, jer većina ljudi email samo preleti pogledom. Podnaslovi pomažu čitaocu da za nekoliko sekundi nađe ono što ga zanima i da preskoči ostalo.${kw}

**Sledeći korak**

Svaki email ima tačno jedan poziv na akciju. Stoji tamo gde će ga čitalac videti i jasno kaže šta se dešava kad klikne. Dobar poziv je konkretan, kratak i lako se prati sa telefona.

**[Ovde ide tvoj poziv na akciju](https://example.com)**

U Live režimu Fanout piše pravi email o tvojoj temi.

Hvala na čitanju,
Fanout primer`,

    x_thread: `1/ Primer niti: ${clip(topic, 100)} 🧵

2/ Ovo je unapred napisan primer. Pokazuje kako Fanout oblikuje nit na X-u pre nego što se uključi bilo kakav AI.

3/ Prava nit počinje udicom u prvoj objavi. Ta objava ima jedan zadatak: da ljudi požele da pročitaju sledeću.

4/ Objave u sredini iznose po jednu poentu, u ${t} tonu. Svaka ostaje ispod 280 znakova, a Fanout te upozori ako neka pređe.

5/ Tvoje ključne reči bile bi uklopljene prirodno, a ne natrpane. Svaku objavu možeš da urediš posle generisanja.

6/ Poslednja objava je poziv na akciju. U Live režimu Fanout piše pravu nit o tvojoj temi.`,
  };
}

export function renderTemplate(input: TemplateInput): Record<ContentType, string> {
  return input.language === "sr" ? serbian(input) : english(input);
}
