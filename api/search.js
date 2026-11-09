export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ success: false, error: "GET 요청만 허용됩니다." });
    }

    const corpName = String(req.query.corpName || "").trim();
    const detailUrl = String(req.query.detailUrl || "").trim();

    if (!corpName && !detailUrl) {
        return res.status(400).json({ success: false, error: "상호명이나 상세 URL이 전달되지 않았습니다." });
    }

    const npsApiKey = process.env.DATA_GO_KR_API_KEY || process.env.NPS_API_KEY;

    function formatBizNo(value) {
        const number = String(value || "").replace(/\D/g, "");
        if (number.length !== 10) return value || "정보없음";
        return number.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3");
    }

    // =========================================================
    // [2단계 & 3단계] 사용자가 선택한 기업 상세 페이지 파싱 + 국민연금 주소 연동
    // =========================================================
    if (detailUrl) {
        try {
            // 비즈노 상세 페이지 HTML 크롤링
            const biznoDetail = await fetchAndParseBiznoDetail(detailUrl, corpName);
            const cleanBizno = biznoDetail.bizno.replace(/\D/g, "");

            let finalAddress = biznoDetail.address;
            let addressSource = "비즈노";

            // 국민연금공단 API 조회 (비즈노에서 확보한 사업자번호 기준)
            if (npsApiKey && cleanBizno.length >= 6) {
                try {
                    const npsUrl = "http://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2/getBassInfoSearchV2";
                    const params = new URLSearchParams({
                        serviceKey: npsApiKey,
                        bzowrRgstNo: cleanBizno.substring(0, 6),
                        wkplNm: corpName,
                        dataType: "json",
                        pageNo: "1",
                        numOfRows: "10"
                    });

                    const npsRes = await fetch(`${npsUrl}?${params.toString()}`);
                    if (npsRes.ok) {
                        const npsData = await npsRes.json();
                        const items = npsData?.response?.body?.items?.item;
                        let npsList = Array.isArray(items) ? items : (items ? [items] : []);

                        const matched = npsList.find(n => {
                            const nBiz = String(n.bzowrRgstNo || "").replace(/\D/g, "");
                            return cleanBizno.startsWith(nBiz.replace(/\*/g, ""));
                        }) || npsList[0];

                        if (matched && matched.wkplRoadNmDtlAddr) {
                            finalAddress = matched.wkplRoadNmDtlAddr;
                            addressSource = "국민연금";
                        }
                    }
                } catch (e) {
                    console.warn("국민연금 API 조회 실패, 비즈노 주소 유지:", e.message);
                }
            }

            return res.status(200).json({
                success: true,
                mode: "detail",
                corpName: corpName,
                bizno: formatBizNo(cleanBizno),
                ceo: biznoDetail.ceo,
                phone: biznoDetail.phone,
                status: biznoDetail.status,
                address: finalAddress,
                addressSource: addressSource
            });

        } catch (e) {
            return res.status(500).json({ success: false, error: "상세 정보 파싱 실패: " + e.message });
        }
    }

    // =========================================================
    // [1단계] 비즈노 첫 화면(검색 결과 목록) HTML 파싱
    // =========================================================
    try {
        const searchUrl = "https://bizno.net/?query=" + encodeURIComponent(corpName);
        const response = await fetch(searchUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
        });
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
            const directParsed = await fetchAndParseBiznoDetail(searchUrl, corpName);
            results.push({
                name: corpName,
                ceo: directParsed.ceo,
                status: directParsed.status,
                address: directParsed.address,
                phone: directParsed.phone,
                detailUrl: searchUrl,
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
                const addrMatch = fullClean.match(/((?:서울|부산|대구|인천|광주|대전광역시|대전시|대전\s+[가-힣]+구|울산|세종|경기|강원|충청북|충청남|전라북|전라남|경상북|경상남|제주)[가-힣0-9\-\s\(\)\,\·로길읍면동리]+)/);
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

        return res.status(200).json({
            success: true,
            mode: "list",
            candidates: results
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: "검색 중 오류 발생: " + error.message });
    }
}

// 비즈노 상세 페이지 HTML 파싱 (사업자번호, 대표자, 주소, 전화번호 추출)
async function fetchAndParseBiznoDetail(url, defaultName) {
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        const html = await response.text();

        const textOnly = html.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/?[^>]+(>|$)/g, ' ');
        const lines = textOnly.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const fullTextClean = textOnly.replace(/\s+/g, ' ');

        let ceo = "-";
        let address = "미기재";
        let phone = "번호없음";
        let status = "계속사업자";
        let bizno = "";

        if (fullTextClean.includes("계속사업자")) {
            status = "계속사업자";
        } else if (fullTextClean.includes("폐업자") || (fullTextClean.includes("폐업") && !fullTextClean.includes("계속사업자"))) {
            status = "폐업자";
        } else if (fullTextClean.includes("휴업")) {
            status = "휴업자";
        }

        // 사업자등록번호 파싱
        const biznoMatch = fullTextClean.match(/(\d{3}-\d{2}-\d{5})/);
        if (biznoMatch) {
            bizno = biznoMatch[1];
        }

        // =========================================================
        // 전화번호 파싱 (기업 고유 번호 우선 추출, 세무서 안내 번호 혼입 방지)
        // =========================================================
        const phoneLabelMatch = fullTextClean.match(/(?:전화|연락처|TEL)[\s:]*(\d{2,3}-\d{3,4}-\d{4})/i);
        if (phoneLabelMatch) {
            phone = phoneLabelMatch[1];
        } else {
            const phoneMatch = fullTextClean.match(/(\d{2,3}-\d{3,4}-\d{4})/);
            if (phoneMatch) {
                const taxOfficeIndex = fullTextClean.indexOf("관할세무서");
                const phoneIndex = fullTextClean.indexOf(phoneMatch[1]);
                
                // '관할세무서' 안내 구역보다 뒤에 나오는 번호는 세무서 번호이므로 제외
                if (taxOfficeIndex !== -1 && phoneIndex > taxOfficeIndex) {
                    phone = "번호없음";
                } else {
                    phone = phoneMatch[1];
                }
            } else {
                phone = "번호없음";
            }
        }

        // =========================================================
        // 주소 파싱 (상호명 내의 '대전' 오인식 방지 및 전체 주소 수집)
        // =========================================================
        const addrRegex = /((?:서울|부산|대구|인천|광주|대전광역시|대전시|대전\s+[가-힣]+구|울산|세종|경기|강원|충청북|충청남|전라북|전라남|경상북|경상남|제주)[가-힣0-9\-\s\(\)\,\·로길읍면동리층호번지]+(?:로|길|동|읍|면|리|층|호|번지)?(?:\s*\d+)?(?:\s*\([가-힣\s0-9]+\))?)/;
        const aMatch = fullTextClean.match(addrRegex);
        if (aMatch) {
            let rawAddr = aMatch[1].trim();
            const cutKeywords = ["직원수", "대표자", "업태", "종목", "전화", "관할세무서", "개업일자", "사업자등록번호", "기타 일반"];
            for (const kw of cutKeywords) {
                const idx = rawAddr.indexOf(kw);
                if (idx !== -1) {
                    rawAddr = rawAddr.substring(0, idx).trim();
                }
            }
            address = rawAddr;
        }

        // 대표자 파싱
        for (let j = 0; j < lines.length; j++) {
            const l = lines[j];
            if ((l.includes('*') && l.length >= 2 && l.length <= 6) || /^[가-힣]{2,4}[\*]?$/.test(l)) {
                if (l !== defaultName && !l.includes('시') && !l.includes('구') && !l.includes('동') && !l.includes('로') && !l.includes('주식회사')) {
                    ceo = l;
                    break;
                }
            }
        }

        return { bizno, ceo, status, address, phone };
    } catch (e) {
        return { bizno: "", ceo: "-", status: "계속사업자", address: "상세조회 실패", phone: "번호없음" };
    }
}
