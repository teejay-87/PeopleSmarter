
const hrZucchettiUrl = "https://peoplesmart.hrzucchetti.it/";
const customer = ""; // You find it in the setup URL: https://peoplesmart.hrzucchetti.it/psmartmoXXXXX
const username = "";
const password = "";

createPolyfills();

if (this.Script) {
  // Running in Scriptable
  //await all();
} else {
  // Running in Node
  (async () => all())();
}


async function all() {
  let headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.87 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "it-IT,it;q=0.8,en-US;q=0.5,en;q=0.3",
    "Accept-Encoding": "gzip, deflate, br",
  };

  let opts = {
    headers: headers,
  };

  let optsPost = {
    ...opts,
    method: "POST",
    body: `grant_type=password&username=psmart${customer}%5C%5C${username}&password=${password}`
  };

  req = new Request(`${hrZucchettiUrl}psmartmo${customer}/Token`, optsPost);

  let aspNetCookie = "";
  let bearerToken = "";

  if (this.Script) {
    // Running in Scriptable
    req.headers = optsPost.headers;
    req.method = optsPost.method;
    req.body = optsPost.body;

    const res = await req.loadJSON();
    aspNetCookie = req.response
      .headers["Set-Cookie"]
      .match("\\.AspNet\\.Cookies=[^;]+")[0];
    bearerToken = res.access_token;
  } else {
    // Running in Node
    const raw = await fetch(req);
    const res = await raw.json();
    aspNetCookie = raw.headers
      .get("Set-Cookie")
      .match("\\.AspNet\\.Cookies=[^;]+")[0];
    bearerToken = res.access_token;
  }

  headers["Cookie"] = aspNetCookie;
  headers["Authorization"] = `Bearer ${bearerToken}`;

  let promises = [
    getMonthFlexesText(opts, new Date())
  ];

  let allMonthFlexesTexts = (await Promise.all(promises)).join("\n-----------------\n")

  console.log(allMonthFlexesTexts);

  this.Script?.setShortcutOutput(allMonthFlexesTexts);
  this.Script?.complete();
}

async function getMonthFlexesText(requestOptions, monthDate) {
  const monthData = await getMonthDataGroupedByDay(requestOptions, monthDate);

  const dayFlexes = getDayFlexes(monthData);
  const dayFlexesText = Object.entries(dayFlexes).map(([day, dayFlex]) =>
    `[${day < 10 ? '0' : ''}${day}] ${dayFlex.flex < 0 ? '' : ' '}${formattedTimeSpan(dayFlex.flex)}` +
    `${dayFlex.totalWfhTime > 0 ? ' (' + formattedTimeSpan(dayFlex.totalWfhTime) + ' wfh)' : ''}` +
    `${dayFlex.totalLeaveTime > 0 ? ' (' + formattedTimeSpan(dayFlex.totalLeaveTime) + ' rol)' : ''}`).join("\n");

  const monthFlex = getMonthFlex(dayFlexes);
  const monthFlexText = `## Totale: ${formattedTimeSpan(monthFlex)}`;

  const totalText = `# Cartellino ${monthDate.toLocaleString('it-IT', { month: 'long', year: 'numeric' })}\n${dayFlexesText}\n${monthFlexText}`;

  return totalText;
}

async function getMonthDataGroupedByDay(requestOptions, monthDate) {
  const evidencyCodeToIgnore = [
    '319',  // CHIUDI GIUSTIFIC.
    '361',  // INVERSIONE TIMBRAT.
    '377',  // FLEX MENO
    '378',  // FLEX PIU'
    '388'   // FLEX PIU' AUTORIZ. (da controllare il significato)
  ];

  const weeks = getWeeksForMonth(monthDate);

  const data = await Promise.all(weeks.map((weekDate) => getWeekData(requestOptions, weekDate)));

  const stampings = data.flatMap((weekData) => weekData.Stampings);
  const evidencies = data.flatMap((weekData) => weekData.Evidencies);

  const filterMonthCondition = (el) => el.StartTime.getMonth() === monthDate.getMonth();
  const filterEvidenciesCondition = (el) => !evidencyCodeToIgnore.includes(el.Code);
  const groupByKeySelector = (el) => (el.StartTime || el.EndTime).getDate();

  const stampingsByDay = stampings.filter(filterMonthCondition).groupBy(groupByKeySelector);
  const evidenciesByDay = evidencies.filter((el) => filterMonthCondition(el) && filterEvidenciesCondition(el)).groupBy(groupByKeySelector);

  const allDays = [...new Set(Object.keys(stampingsByDay).concat(Object.keys(evidenciesByDay)))];
  const allDaysSorted = allDays.sort((a, b) => a - b);

  const dataByDay = allDaysSorted.toDictionary(null, function (day) {
    return {
      Stampings: stampingsByDay[day],
      Evidencies: evidenciesByDay[day],
    }
  });

  return dataByDay;
}

async function getWeekData(requestOptions, weekDate) {
  // Compose request
  let req = new Request(`${hrZucchettiUrl}psmartmo${customer}/Api/Agenda?day=${formattedEnglishDate(weekDate)}`, requestOptions);

  let res = "";

  if (this.Script) {
    // Running in Scriptable
    req.headers = requestOptions.headers;

    res = await req.loadJSON()
  } else {
    // Running in Node
    res = await fetch(req).then((result) => result.json());
  }

  // Remove Year-0001 dates
  const fixDates = (el) => {
    el.StartTime = el.StartTime[0] != 0 ? new Date(el.StartTime) : null;
    el.EndTime = el.EndTime[0] != 0 ? new Date(el.EndTime) : null;
  };

  res.Data.Stampings.forEach(fixDates);
  res.Data.Evidencies.forEach(fixDates);

  return res.Data;
}

function getDayFlexes(monthData) {
  return Object.entries(monthData).toDictionary(
    function ([day, dayFlex]) { return day; },
    function ([day, dayFlex]) {
      const workTimes = dayFlex.Stampings?.map(stamping => getWorkTime(stamping));
      const wfhTimes = dayFlex.Evidencies?.filter(evidency => evidency.Code == '330').map(evidency => evidency.Quantity / 100 * 60);
      const leaveTimes = dayFlex.Evidencies?.filter(evidency => evidency.Code != '330').map(evidency => evidency.Quantity / 100 * 60);
      const totalWorkTime = workTimes?.sum() || 0;
      const totalWfhTime = wfhTimes?.sum() || 0;
      const totalLeaveTime = leaveTimes?.sum() || 0;
      const flex = (totalWorkTime + totalWfhTime + totalLeaveTime) - 8 * 60;

      return {
        flex,
        totalWfhTime,
        totalLeaveTime
      };
    }
  );
}

function getWorkTime(stamping) {
  let startTime = stamping.StartTime;
  let endTime = stamping.EndTime;
  if (startTime == null) {
    return 0;
  }
  if (endTime == null) {
    const now = new Date();
    if (new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate()).getTime() !== new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
      return 0;
    }
    now.setSeconds(0, 0);
    endTime = now;
  }
  // Fix start time before 8:30
  if (startTime.getHours() < 8 || (startTime.getHours() === 8 && startTime.getMinutes() < 30)) {
    startTime = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate(), 8, 30);
  }
  // Fix start time after 9:30 but till 9:45 (CHIUDI GIUSTIFIC.)
  if (startTime.getHours() === 9 && startTime.getMinutes() > 30 && startTime.getMinutes() < 45) {
    startTime = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate(), 9, 45);
  }
  // Fix end time after 19:00
  if (endTime.getHours() >= 19) {
    endTime = new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate(), 19, 0);
  }
  let diffInMins = (endTime - startTime) / 1000 / 60;
  // Unique work session (for example 9 => 18)
  if (diffInMins >= 5.5 * 60) {
    diffInMins -= 30;
  } else {
    // Fix end time after 13:30
    if ((startTime.getHours() < 12 || (startTime.getHours() === 12 && startTime.getMinutes() < 30))
      && (endTime.getHours() > 13 || (endTime.getHours() === 13 && endTime.getMinutes() > 30))) {
      endTime = new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate(), 13, 30);
      diffInMins = (endTime - startTime) / 1000 / 60;
    }
  }
  return diffInMins;
}

function getMonthFlex(dayFlexes) {
  return Object.values(dayFlexes).map(dayFlex => dayFlex.flex).sum();
}

function getWeeksForMonth(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstOfMonthDay = firstOfMonth.getDay();

  let weeks = [];

  if (firstOfMonthDay !== 1) {
    // Add partial week
    weeks.push(firstOfMonth);
  }

  // Go to first monday of month
  let currentWeek = new Date(year, month, 1 + ((8 - firstOfMonthDay) % 7));

  do {
    weeks.push(currentWeek);
    currentWeek = new Date(year, month, currentWeek.getDate() + 7);
  } while (currentWeek.getMonth() == month);

  return weeks;
}

function formattedEnglishDate(d) {
  // Get date in YYYY-MM-DD format
  let month = String(d.getMonth() + 1);
  let day = String(d.getDate());
  const year = String(d.getFullYear());

  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;

  return `${year}-${month}-${day}`;
}

function formattedDate(d) {
  // Get date in DD/MM/YY format
  let month = String(d.getMonth() + 1);
  let day = String(d.getDate());
  const year = String(d.getFullYear()).substring(2);

  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;

  return `${day}/${month}/${year}`;
}

function formattedTime(d) {
  // Get time in HH:MM format
  let hours = String(d.getHours());
  let minutes = String(d.getMinutes());

  if (hours.length < 2) hours = "0" + hours;
  if (minutes.length < 2) minutes = "0" + minutes;

  return `${hours}:${minutes}`;
}

function formattedTimeSpan(ts) {
  const tsHours = Math.floor(Math.abs(ts) / 60);
  const tsMins = Math.abs(ts) % 60;
  return `${ts < 0 ? '-' : ''}${tsHours}:${tsMins < 10 ? '0' : ''}${tsMins}`;
}

function createPolyfills() {
  Array.prototype.sum = function () {
    return this.reduce((a, b) => a + b, 0);
  };

  Array.prototype.groupBy = function (keySelector) {
    if (!keySelector.call) {
      const key = keySelector;
      keySelector = (x) => x[key];
    }
    return this.reduce(function (retVal, x) {
      const keyVal = keySelector(x);
      (retVal[keyVal] = retVal[keyVal] || []).push(x);
      return retVal;
    }, {});
  };

  Array.prototype.toDictionary = function (keySelector, valueSelector) {
    return this.reduce(function (retVal, element) {
      retVal[keySelector != null ? keySelector(element) : element] = valueSelector(element);
      return retVal;
    }, {});
  }
}
