export default async function handler(req, res) {
    const { corpName, address } = req.query;

    if (!corpName) {
        return res.status(400).json({ error: "상호명을 입력해 주세요." });
    }

    const apiKey = process.env.DATA_GO_KR_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "서버 API 키가 설정되지 않았습니다." });
    }

    try {
        // 한글 상호명 인코딩 및 URL 생성 (디코딩된 API 키를 직접 붙이는 방식)
        const encodedCorpNm = encodeURIComponent(corpName.trim());
        const url = `https://apis.data.go.kr/1160100/service/GetCorpOutlineInfoService_v2/getCorpOutline_V2?serviceKey=${apiKey}&resultType=json&pageNo=1&numOfRows=10&corpNm=${encodedCorpNm}`;

        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        
        const text = await response.text();
        console.log("=== API 원본 응답 ===", text); // Vercel 로그에서 확인용

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            // API에서 XML이나 에러 메시지가 전달된 경우
            return res.status(200).json({
                success: false,
                corpName: "API 응답 형식이 다릅니다 (인증/권한 확인)",
                ceoNm: text.substring(0, 50),
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: "정보없음",
                status: "오류"
            });
        }

        const items = data?.response?.body?.items?.item;
        let itemList = [];
        
        if (Array.isArray(items)) {
            itemList = items;
        } else if (items) {
            itemList = [items];
        }

        if (itemList.length === 0) {
            return res.status(200).json({
                success: false,
                corpName: `${corpName} (조회된 결과 없음)`,
                ceoNm: "정보없음",
                bizno: "정보없음",
                crno: "정보없음",
                phone: "정보없음",
                address: address || "정보없음",
                status: "결과없음"
            });
        }

        // 가장 잘 일치하는 첫 번째 결과 추출
        const target = itemList[0];

        return res.status(200).json({
            success: true,
            corpName: target.corpNm || corpName,
            ceoNm: target.ceoNm || "정보없음",
            bizno: target.bizNo || "정보없음",
            crno: target.crno || "정보없음",
            phone: target.enpTlno || "정보없음",
            address: target.enpBsadr || "정보없음",
            status: "계속사업자"
        });

    } catch (error) {
        console.error("서버 내부 에러:", error);
        return res.status(500).json({ error: "서버 통신 실패: " + error.message });
    }
}
