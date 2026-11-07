export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            error: "GET 요청만 허용됩니다."
        });
    }

    const corpName = String(req.query.corpName || "").trim();
    const address = String(req.query.address || "").trim();

    if (!corpName) {
        return res.status(400).json({
            success: false,
            error: "상호명을 입력해 주세요."
        });
    }

    const biznoApiKey = process.env.BIZNO_API_KEY;
    const ntsApiKey = process.env.NTS_API_KEY;
    const financeApiKey = process.env.DATA_GO_KR_API_KEY;

    if (!biznoApiKey) {
        return res.status(500).json({
            success: false,
            error: "비즈노 API 인증키(BIZNO_API_KEY)가 설정되지 않았습니다."
        });
    }

    // 번호 포맷팅 함수
    function formatBizNo(value) {
        const number = String(value || "").replace(/\D/g, "");
        if (number.length !== 10) return value || "정보없음";
        return number.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3");
    }

    function formatCorpNo(value) {
        const number = String(value || "").replace(/\D/g, "");
        if (number.length !== 13) return value || "정보없음";
        return number.replace(/^(\d{6})(\d{7})$/, "$1-$2");
    }

    // 정규화 및 주소 매칭 함수
    function normalize(value) {
        return String(value || "")
            .replace(/주식회사|㈜|\(주\)|주\)/g, "")
            .replace(/\s/g, "")
            .replace(/[()（）]/g, "")
            .toLowerCase();
    }

    function matchAddress(companyAddress, searchAddress) {
        if (!searchAddress) return false;
        const company = normalize(companyAddress);
        const keywords = searchAddress.split(/\s+/).filter(Boolean).map(normalize);
        return keywords.length > 0 && keywords.every(keyword => company.includes(keyword));
    }

    try {
        // =====================================
        // 1단계: 비즈노 API (상호명 검색 및 사업자번호 확보)
        // =====================================
        const biznoUrl = new URL("https://bizno.net/api/fapi");
        biznoUrl.searchParams.set("key", biznoApiKey);
        biznoUrl.searchParams.set("gb", "3"); // 3: 상호명 검색
        biznoUrl.searchParams.set("q", corpName);
        if (address) {
            biznoUrl.searchParams.set("area", address);
        }
        biznoUrl.searchParams.set("type", "json");

        const biznoResponse = await fetch(biznoUrl.toString());
        const biznoRawText = await biznoResponse.text();

        if (!biznoResponse.ok) {
            return res.status(502).json({
                success: false,
                error: `비즈노 API HTTP 오류: ${biznoResponse.status}`,
                detail: biznoRawText.substring(0, 300)
            });
        }

        let biznoData;
        try {
            biznoData = JSON.parse(biznoRawText);
        } catch {
            return res.status(502).json({
                success: false,
                error: "비즈노 응답이 JSON 형식이 아닙니다.",
                detail: biznoRawText.substring(0, 300)
            });
        }

        if (biznoData.resultCode !== 0 && biznoData.resultCode !== "0") {
            return res.status(502).json({
                success: false,
                error: "비즈노 API 오류",
                resultCode: biznoData.resultCode,
                resultMsg: biznoData.resultMsg || "검색 결과가 없습니다."
            });
        }

        const itemList = biznoData.items || [];
        const totalCount = Number(biznoData.totalCount || itemList.length);

        if (itemList.length === 0) {
            return res.status(200).json({
                success: false,
                error: "해당 상호명으로 등록된 기업정보가 비즈노에 없습니다.",
                corpName: corpName
            });
        }

        // 검색어 및 주소 매칭으로 가장 정확한 후보 선정
        const searchName = normalize(corpName);
        const rankedItems = itemList.map(item => {
            const companyName = normalize(item.company);
            const companyAddress = item.address || item.addr || "";
            let score = 0;

            if (companyName === searchName) score += 100;
            else if (companyName.includes(searchName) || searchName.includes(companyName)) score += 50;

            if (address && matchAddress(companyAddress, address)) score += 30;

            return { item, score };
        });

        rankedItems.sort((a, b) => b.score - a.score);
        const target = rankedItems[0].item;

        const businessNumber = String(target.bno || "").replace(/\D/g, "");
        let initialCompanyName = target.company || corpName;
        let initialCrno = target.cno || "";
        let initialAddress = target.address || target.addr || "정보없음";
        let ceoName = "정보없음";
        let phoneNum = "정보없음";

        // =====================================
        // 2단계: 국세청 API (사업자 상태 검증 - 계속/휴업/폐업)
        // =====================================
        let ntsStatus = "국세청 조회 필요";

        if (!ntsApiKey) {
            ntsStatus = "국세청 인증키 미설정";
        } else if (!/^\d{10}$/.test(businessNumber)) {
            ntsStatus = "사업자등록번호 형식 오류";
        } else {
            try {
                const ntsUrl = new URL("https://api.odcloud.kr/api/nts-businessman/v1/status");
                ntsUrl.searchParams.set("serviceKey", ntsApiKey);

                const ntsResponse = await fetch(ntsUrl.toString(), {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({ b_no: [businessNumber] })
                });

                if (ntsResponse.ok) {
                    const ntsText = await ntsResponse.text();
                    const ntsData = JSON.parse(ntsText);
                    const resultList = ntsData?.data || [];
                    const ntsResult = resultList.find(
                        item => String(item.b_no || "").replace(/\D/g, "") === businessNumber
                    );

                    if (!ntsResult) {
                        ntsStatus = "국세청 조회 결과 없음";
                    } else if (ntsResult.b_stt_cd === "01") {
                        ntsStatus = "계속사업자";
                    } else if (ntsResult.b_stt_cd === "02") {
                        ntsStatus = "휴업자";
                    } else if (ntsResult.b_stt_cd === "03") {
                        ntsStatus = "폐업자";
                    } else {
                        ntsStatus = ntsResult.b_stt || "정보 확인 필요";
                    }
                } else {
                    ntsStatus = "국세청 조회 HTTP 오류";
                }
            } catch (error) {
                console.error("국세청 API 오류:", error);
                ntsStatus = "국세청 조회 오류";
            }
        }

        // =====================================
        // 3단계: 금융위원회 API (기업 상세정보 보완)
        // =====================================
        if (financeApiKey) {
            try {
                const financeUrl = "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";
                const params = new URLSearchParams({
                    serviceKey: financeApiKey,
                    resultType: "json",
                    pageNo: "1",
                    numOfRows: "5",
                    corpNm: corpName
                });

                const finResponse = await fetch(`${financeUrl}?${params.toString()}`);
                if (finResponse.ok) {
                    const finText = await finResponse.text();
                    const finData = JSON.parse(finText);
                    const finItems = finData?.response?.body?.items?.item;
                    let finList = Array.isArray(finItems) ? finItems : (finItems ? [finItems] : []);

                    const matchedFin = finList.find(f => {
                        const fBiz = String(f.bzno || "").replace(/\D/g, "");
                        return fBiz === businessNumber || normalize(f.corpNm) === normalize(initialCompanyName);
                    }) || finList[0];

                    if (matchedFin) {
                        if (matchedFin.enpRprFnm) ceoName = matchedFin.enpRprFnm;
                        if (matchedFin.enpTlno) phoneNum = matchedFin.enpTlno;
                        if (matchedFin.enpBsadr) initialAddress = matchedFin.enpBsadr;
                        if (matchedFin.crno) initialCrno = matchedFin.crno;
                    }
                }
            } catch (e) {
                console.warn("금융위원회 보완 조회 생략:", e.message);
            }
        }

        // =====================================
        // 최종 결과 반환 (과세유형, 폐업일 제외)
        // =====================================
        return res.status(200).json({
            success: true,
            corpName: initialCompanyName,
            ceoNm: ceoName,
            bizno: formatBizNo(businessNumber),
            crno: formatCorpNo(initialCrno),
            phone: phoneNum,
            address: initialAddress,
            status: ntsStatus,
            totalCount: totalCount,
            returnedCount: itemList.length,
            source: "비즈노 + 국세청 + 금융위원회"
        });

    } catch (error) {
        console.error("기업정보 통합 조회 오류:", error);
        return res.status(500).json({
            success: false,
            error: "서버 통신 실패",
            detail: error.message
        });
    }
}
