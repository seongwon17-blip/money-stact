/**
 * 닥터팔레트 매출·수납 차이 분석기 — app.js (수정본)
 */

/* ── 유틸 함수 ── */
const won = n => {
  const v = Math.round(Number(n));
  return isNaN(v) ? '0원' : v.toLocaleString('ko-KR') + '원';
};

const wonSign = n => {
  const v = Math.round(Number(n));
  if (isNaN(v) || v === 0) return '0원';
  return (v > 0 ? '+' : '-') + Math.abs(v).toLocaleString('ko-KR') + '원';
};

/**
 * 컬럼명 찾기 유틸리티
 * 컬럼명에 공백이 있거나 미세하게 달라도 찾아냅니다.
 */
const getVal = (row, keywords) => {
  const keys = Object.keys(row);
  for (const kw of keywords) {
    const foundKey = keys.find(k => k.replace(/\s/g, '').includes(kw.replace(/\s/g, '')));
    if (foundKey) return row[foundKey];
  }
  return null;
};

const toN = v => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).replace(/[^0-9\-\.]/g, '').trim();
  if (!s || s === '-' || s === '.') return 0;
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};

const cleanId = v => {
  if (!v) return null;
  const s = String(v).replace(/[="]/g, '').trim();
  return (s === '-' || !s) ? null : s;
};

/* ── 파일 업로드 처리 ── */
let dataSales = null;
let dataCol = null;

function setupUpload(inputId, boxId, tagId, type) {
  const inp = document.getElementById(inputId);
  const box = document.getElementById(boxId);
  const tag = document.getElementById(tagId);

  inp.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: result => {
        console.log(`${type} 데이터 샘플:`, result.data[0]); // 디버깅용
        if (type === 'sales') dataSales = result.data;
        else dataCol = result.data;

        box.classList.add(type === 'sales' ? 'ok-sales' : 'ok-col');
        tag.textContent = '✓ ' + file.name;
        document.getElementById('btn').disabled = !(dataSales && dataCol);
      }
    });
  });
}

setupUpload('f-sales', 'box-sales', 'tag-sales', 'sales');
setupUpload('f-col', 'box-col', 'tag-col', 'col');

/* ── 분석 실행 ── */
document.getElementById('btn').addEventListener('click', () => {
  document.getElementById('err').style.display = 'none';
  document.getElementById('loading').style.display = 'block';
  document.getElementById('result').style.display = 'none';

  setTimeout(() => {
    try {
      const analysisResult = analyze(dataSales, dataCol);
      render(analysisResult);
    } catch (e) {
      const errEl = document.getElementById('err');
      errEl.style.display = 'block';
      errEl.textContent = '⚠ 분석 오류: ' + e.message;
    } finally {
      document.getElementById('loading').style.display = 'none';
    }
  }, 100);
});

/* ── 핵심 분석 로직 ── */
function analyze(d1, d2) {
  // 1. 데이터 타입 자동 감지 (매출 vs 수납)
  // '총 매출' 컬럼이 있으면 매출 데이터로 간주
  let maRaw, suRaw;

  const hasKey = (row, kw) => Object.keys(row).some(k => k.replace(/\s/g, '').includes(kw));
  
  // 첫 번째 행으로 판단
  const isMa1 = d1.length > 0 && (hasKey(d1[0], '총매출') || hasKey(d1[0], '진료비총액'));
  const isMa2 = d2.length > 0 && (hasKey(d2[0], '총매출') || hasKey(d2[0], '진료비총액'));

  if (isMa1 && !isMa2) { maRaw = d1; suRaw = d2; }
  else if (!isMa1 && isMa2) { maRaw = d2; suRaw = d1; }
  else {
    // 자동 감지 실패 시 기본값 (업로드 순서대로)
    // 하지만 보통 한쪽이라도 확실하면 스왑해주는게 좋음
    if (d1.length > 0 && hasKey(d1[0], '수납일')) { maRaw = d2; suRaw = d1; } // d1이 수납이면 d2는 매출
    else { maRaw = d1; suRaw = d2; }
  }

  // 수납 데이터 가공
  const su = suRaw.map(r => {
    const card = toN(getVal(r, ['카드']));
    const cash1 = toN(getVal(r, ['현금_창구수납', '현금창구', '현금수납'])); // 현금수납 추가
    const cash2 = toN(getVal(r, ['현금_계좌이체', '계좌이체']));
    const pay = toN(getVal(r, ['페이']));
    const plat = toN(getVal(r, ['플랫폼']));
    const etc = toN(getVal(r, ['기타']));
    const prepay = toN(getVal(r, ['선납금 입출금', '선납금입출금', '선납급'])); // 선납금 오타 수정

    return {
      nm: String(getVal(r, ['환자명']) || '').trim(),
      id: cleanId(getVal(r, ['접수번호', '환자번호'])), // 환자번호 fallback 추가
      payDate: String(getVal(r, ['수납일']) || '').trim(),
      trtDate: String(getVal(r, ['진료일']) || '').trim(),
      refDate: String(getVal(r, ['환불일']) || '').trim(),
      sys: card + cash1 + cash2 + pay + plat + etc + prepay,
      prepay: prepay
    };
  });

  // 매출 데이터 가공
  const ma = maRaw.map(r => ({
    nm: String(getVal(r, ['환자명']) || '').trim(),
    id: cleanId(getVal(r, ['접수번호', '환자번호'])),
    trtDate: String(getVal(r, ['진료일']) || '').trim(),
    amt: toN(getVal(r, ['총 매출', '총매출', '진료비총액'])) // 진료비총액 fallback
  }));

  // 데이터 무결성 체크
  if (ma.length === 0 || su.length === 0) {
    throw new Error('데이터 파싱 결과가 없습니다. 컬럼명을 확인해주세요.');
  }

  // 타겟 월 추출 (수납일 기준 가장 많은 달)
  const monthCounts = {};
  su.forEach(r => {
    // YYYY-MM 형식 추출 (2026-02-03 -> 2026-02)
    const m = r.payDate.slice(0, 7);
    if (m && m.match(/^\d{4}-\d{2}$/)) monthCounts[m] = (monthCounts[m] || 0) + 1;
  });
  
  // 데이터가 가장 많은 달을 타겟으로 설정
  const sortedMonths = Object.entries(monthCounts).sort((a, b) => b[1] - a[1]);
  const TARGET = sortedMonths.length > 0 ? sortedMonths[0][0] : '';

  if (!TARGET) {
    throw new Error('분석할 기준 월(수납일)을 찾을 수 없습니다.');
  }

  const totalSu = su.reduce((s, r) => s + r.sys, 0);
  const totalMa = ma.reduce((s, r) => s + r.amt, 0);
  const diff = totalSu - totalMa;

  // 원인 분석
  // 1. A: 타겟 월 이전 수납이지만, 타겟 월에 환불된 건 (sys < 0)
  //    조건: 수납일은 타겟 월이 아님 && 환불일은 타겟 월임
  const causeA = su.filter(r => !r.payDate.startsWith(TARGET) && r.refDate.startsWith(TARGET) && r.sys < 0);

  // 2. B: 타겟 월에 수납되었지만, 진료는 이전 달인 건 (sys > 0)
  //    조건: 수납일은 타겟 월임 && 진료일이 존재하고 타겟 월이 아님
  const causeB = su.filter(r => r.payDate.startsWith(TARGET) && r.trtDate && !r.trtDate.startsWith(TARGET) && r.sys > 0);

  // 3. C: 타겟 월 진료 후 매출은 잡혔으나, 수납 내역(현금/카드 등)이 없는 경우 (주로 선납금 결제 또는 미수)
  //    조건: 진료일은 타겟 월임 && 매출 > 0 && (접수번호 매칭 실패)
  //    매칭 키: 접수번호 우선, 없으면 이름+진료일
  const suKeys = new Set();
  su.forEach(r => {
    if (r.payDate.startsWith(TARGET)) {
      if (r.id) suKeys.add(r.id);
      suKeys.add(`${r.nm}_${r.trtDate}`);
    }
  });

  const causeC = ma.filter(r => {
    if (!r.trtDate.startsWith(TARGET) || r.amt <= 0) return false;
    // 수납 내역에 있는지 확인
    if (r.id && suKeys.has(r.id)) return false;
    if (suKeys.has(`${r.nm}_${r.trtDate}`)) return false;
    return true;
  });

  // 선납금 사용 내역 매핑 (원인 C 상세 분석용)
  // 선납금은 진료일이 비어있거나 다를 수 있으므로 이름으로 매핑
  const prepayMap = {};
  su.forEach(r => {
    if (r.prepay > 0) {
      prepayMap[r.nm] = (prepayMap[r.nm] || 0) + r.prepay;
    }
  });

  const amtA = causeA.reduce((s, r) => s + r.sys, 0);
  const amtB = causeB.reduce((s, r) => s + r.sys, 0);
  const amtC = causeC.reduce((s, r) => s + r.amt, 0);
  const residual = diff - (amtA + amtB - amtC);

  return { totalSu, totalMa, diff, TARGET, causeA, causeB, causeC, prepayMap, amtA, amtB, amtC, residual };
}

/* ── 렌더링 함수 (생략 없이 모두 포함) ── */
function render(d) {
  const { totalSu, totalMa, diff, TARGET, causeA, causeB, causeC, prepayMap, amtA, amtB, amtC, residual } = d;

  const dCls = diff < 0 ? 'c-neg' : diff > 0 ? 'c-pos' : 'c-zero';
  document.getElementById('sum-row').innerHTML = `
    <div class="sum-box c-col">
      <div class="sum-box__label">수납통계 합계</div>
      <div class="sum-box__amt">${won(totalSu)}</div>
      <div class="sum-box__sub">${TARGET} 수납일 기준</div>
    </div>
    <div class="sum-box c-sale">
      <div class="sum-box__label">매출통계 합계</div>
      <div class="sum-box__amt">${won(totalMa)}</div>
      <div class="sum-box__sub">${TARGET} 진료일 기준</div>
    </div>
    <div class="sum-box ${dCls}">
      <div class="sum-box__label">차이 (수납-매출)</div>
      <div class="sum-box__amt">${wonSign(diff)}</div>
      <div class="sum-box__sub">분석 결과 확인</div>
    </div>
  `;

  // 원인 리스트 생성 로직
  const listEl = document.getElementById('cause-list');
  let html = '';
  
  if(causeA.length > 0) html += makeCard('t-a', '원인 A', '이전달 진료건 당월 환불', amtA, causeA.length, tblA(causeA));
  if(causeB.length > 0) html += makeCard('t-b', '원인 B', '이전달 진료건 당월 수납', amtB, causeB.length, tblB(causeB));
  if(causeC.length > 0) html += makeCard('t-c', '원인 C', '당월 미수납(선납/미수)', -amtC, causeC.length, tblC(causeC, prepayMap));
  
  listEl.innerHTML = html || '<div class="no-diff">차이가 없습니다.</div>';

  // 검증식 렌더링
  document.getElementById('verify').innerHTML = `
    <div class="vrow"><span class="vl">매출통계 합계</span><span class="vv">${won(totalMa)}</span></div>
    <div class="vrow"><span class="vl">원인 A (환불 반영)</span><span class="vv">${wonSign(amtA)}</span></div>
    <div class="vrow"><span class="vl">원인 B (미수 수납)</span><span class="vv">${wonSign(amtB)}</span></div>
    <div class="vrow"><span class="vl">원인 C (당월 미수)</span><span class="vv">${wonSign(-amtC)}</span></div>
    <div class="vrow last"><span class="vl">계산된 수납합계</span><span class="vv">${won(totalSu)}</span></div>
  `;

  document.getElementById('result').style.display = 'block';
}

function makeCard(cls, tag, title, amt, count, table) {
  const id = 'card-' + Math.random().toString(36).substr(2, 9);
  return `
    <div class="cause-card ${cls}" id="${id}">
      <div class="cause-card__head" onclick="toggle('${id}')">
        <span class="cause-card__tag">${tag}</span>
        <div class="cause-card__info">
          <div class="cause-card__title">${title} (${count}건)</div>
        </div>
        <span class="cause-card__amt">${wonSign(amt)}</span>
      </div>
      <div class="cause-card__body">${table}</div>
    </div>
  `;
}

function toggle(id) { document.getElementById(id).classList.toggle('open'); }

/* 테이블 헬퍼들 */
function tblA(data) {
  return `<div class="tbl-wrap"><table><thead><tr><th>환자명</th><th>환불일</th><th>금액</th></tr></thead><tbody>` + 
    data.map(r => `<tr><td>${r.nm}</td><td>${r.refDate}</td><td>${won(r.sys)}</td></tr>`).join('') + `</tbody></table></div>`;
}
function tblB(data) {
  return `<div class="tbl-wrap"><table><thead><tr><th>환자명</th><th>수납일</th><th>금액</th></tr></thead><tbody>` + 
    data.map(r => `<tr><td>${r.nm}</td><td>${r.payDate}</td><td>${won(r.sys)}</td></tr>`).join('') + `</tbody></table></div>`;
}
function tblC(data, pm) {
  return `<div class="tbl-wrap"><table><thead><tr><th>환자명</th><th>매출액</th><th>비고</th></tr></thead><tbody>` + 
    data.map(r => `<tr><td>${r.nm}</td><td>${won(r.amt)}</td><td>${pm[r.nm]?'선납사용':'미수'}</td></tr>`).join('') + `</tbody></table></div>`;
}
