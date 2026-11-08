export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "GET 요청만 허용됩니다." });
    }

    const corpName = String(req.query.corpName || "").trim();
    const detailUrl = String(req.query.detailUrl || "").trim();

    if (!corpName && !detailUrl) {
        return res.status(400).json({ success: false, error: "조회할 상호명이나 URL이 전달되지 않았습니다." });
    }

    // 2단계: 특정 기업 상세 정보 조회
    if (detailUrl) {
        try {
            const detailData = await fetchAndParseDetail(detailUrl, corpName);
            return res.status(200).json({
                success: true,
                mode: "detail",
                result: detailData
            });
        } catch (e) {
            return res.status(500).json({ success: false, error: "상세 정보 조회 오류: " + e.message });
        }
    }

    // 1단계: 상호명 검색 및 동명이인 목록 추출
    try {
        const searchUrl = "https://bizno.net/?query=" + encodeURIComponent(corpName);
        const options = {
            method: "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        };

        const response = await fetch(searchUrl, options);
        const html = await response.text();

        if (html.includes("검색결과가 없습니다") || html.includes("조회된 데이터가 없습니다")) {
            return res.status(200).json({
                success: true,
                mode: "list",
                candidates: [{
                    name: corpName,
                    ceo: "-",
                    status: "-",
                    address: "검색 결과 없음",
                    phone: "-",
                    detailUrl: "",
                    isMultiple: false
                }]
            });
        }

        let items = [];
        const rawSplits = html.split('class="titles"');
        if (rawSplits.length > 1) {
            for (let k = 1; k < rawSplits.length; k++) {
                if (rawSplits[k].includes('href') || rawSplits[k].includes('주소')) {
                    items.push(rawSplits[k]);
                }
            }
        }

        if (items.length === 0) {
            const rawList = html.split('class="list-item"');
            for (let l = 1; l < rawList.length; l++) {
                items.push(rawList[l]);
            }
        }

        let results = [];

        if (items.length === 0) {
            const parsed = await fetchAndParseDetail(searchUrl, corpName);
            results.push({
                name: corpName,
                ceo: parsed.ceo,
                status: parsed.status,
                address: parsed.address,
                phone: parsed.phone,
                detailUrl: "",
                isMultiple: false
            });
        } else {
            for (let i = 0; i < items.length && i < 10; i++) {
                const itemHtml = items[i];
                
                const titleMatch = itemHtml.match(/<a[^>]*>([^<]+)<\/a>/);
                let compName = titleMatch ? titleMatch[1].trim() : corpName;
                
                if (!compName || compName.includes("사업자등록번호") || compName.includes("HOME") || compName.length < 2) {
                    compName = corpName;
                }

                const linkMatch = itemHtml.match(/href="([^"]+)"/);
                let link = linkMatch ? linkMatch[1] : null;
                if (link && !link.startsWith('http')) {
                    link = "https://bizno.net" + link;
                }

                const textOnly = itemHtml.replace(/<\/?[^>]+(>|$)/g, ' ');
                const fullClean = textOnly.replace(/\s+/g, ' ');

                let status = "계속사업자";
                if (fullClean.includes("폐업")) status = "폐업자";
                else if (fullClean.includes("휴업")) status = "휴업자";

                let ceoMasked = "-";
                const lines = textOnly.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                for (let n = 0; n < lines.length; n++) {
                    const l = lines[n];
                    if ((l.includes('*') && l.length >= 2 && l.length <= 6) || /^[가-힣]{2,4}[\*]?$/.test(l)) {
                        if (l !== compName && !l.includes('시') && !l.includes('구') && !l.includes('동') && !l.includes('로') && !l.includes('주식회사')) {
                            ceoMasked = l;
                            break;
                        }
                    }
                }

                let simpleAddr = "소재지 확인 요망";
                const addrMatch = fullClean.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북|충청남|전라북|전라남|경상북|경상남|제주)[가-힣0-9\-\s\(\)\,\·로길읍면동리]+)/);
                if (addrMatch) {
                    simpleAddr = addrMatch[1].trim();
                }

                results.push({
                    name: compName,
                    ceo: ceoMasked,
                    status: status,
                    address: simpleAddr,
                    phone: "-",
                    detailUrl: link,
                    isMultiple: true
                });
            }
        }

        if (results.length === 1) {
            const finalParsed = results[0].detailUrl ? await fetchAndParseDetail(results[0].detailUrl, results[0].name) : results[0];
            return res.status(200).json({
                success: true,
                mode: "list",
                candidates: [{
                    name: results[0].name,
                    ceo: finalParsed.ceo,
                    status: finalParsed.status,
                    address: finalParsed.address,
                    phone: finalParsed.phone,
                    detailUrl: results[0].detailUrl,
                    isMultiple: false
                }]
            });
        }

        return res.status(200).json({
            success: true,
            mode: "list",
            candidates: results
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: "검색 중 오류 발생: " + error.message });
    }
}

async function fetchAndParseDetail(url, defaultName) {
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        const html = await response.text();
        return parseBiznoDetailDirect(html, defaultName);
    } catch (e) {
        return { ceo: "-", status: "계속사업자", address: "상세조회 실패", phone: "-" };
    }
}

function parseBiznoDetailDirect(html, defaultName) {
    const textOnly = html.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, ' ');
    const lines = textOnly.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const fullTextClean = textOnly.replace(/\s+/g, ' ');

    let ceo = "-";
    let address = "미기재";
    let phone = "미기재";
    let status = "계속사업자";

    if (fullTextClean.includes("계속사업자")) {
        status = "계속사업자";
    } else if (fullTextClean.includes("폐업자") || (fullTextClean.includes("폐업") && !fullTextClean.includes("계속사업자"))) {
        status = "폐업자";
    } else if (fullTextClean.includes("휴업")) {
        status = "휴업자";
    }

    const phoneMatch = fullTextClean.match(/(\d{2,3}-\d{3,4}-\d{4})/);
    if (phoneMatch) {
        phone = phoneMatch[1];
    }

    const addrRegex = /((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북|충청남|전라북|전라남|경상북|경상남|제주)[가-힣0-9\-\s\(\)\,\·로길읍면동리층호번지]+(?:로|길|동|읍|면|리|층|호|번지))/;
    const aMatch = fullTextClean.match(addrRegex);
    if (aMatch) {
        address = aMatch[1].trim();
    }

    for (let j = 0; j < lines.length; j++) {
        const l = lines[j];
        if ((l.includes('*') && l.length >= 2 && l.length <= 6) || /^[가-힣]{2,4}[\*]?$/.test(l)) {
            if (l !== defaultName && !l.includes('시') && !l.includes('구') && !l.includes('동') && !l.includes('로') && !l.includes('주식회사')) {
                ceo = l;
                break;
            }
        }
    }

    return { ceo, status, address, phone };
}
